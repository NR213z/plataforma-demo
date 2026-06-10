#!/usr/bin/env python3
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes

TOKEN = os.environ["BOT_TOKEN"]
PORT = int(os.environ.get("PORT", 8080))

YOUTUBE_REGEX = re.compile(
    r'https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-?=&]+'
)

MAX_SIZE_MB = 50


def ensure_yt_dlp():
    try:
        subprocess.run(["yt-dlp", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Instalando yt-dlp...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--break-system-packages", "yt-dlp"],
            check=True,
        )


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")

    def log_message(self, *args):
        pass  # silenciar logs del servidor HTTP


def start_health_server():
    server = HTTPServer(("0.0.0.0", PORT), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Health server corriendo en puerto {PORT}")


def compress_video(input_path: Path, tmpdir: Path) -> Path | None:
    # obtener duración con ffprobe
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)],
        capture_output=True, text=True
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        return None

    target_bytes = 49 * 1024 * 1024  # 49MB con margen
    total_bitrate = int((target_bytes * 8) / duration)
    audio_bitrate = 128_000
    video_bitrate = max(total_bitrate - audio_bitrate, 100_000)

    output_path = tmpdir / ("compressed_" + input_path.stem + ".mp4")
    result = subprocess.run([
        "ffmpeg", "-y", "-i", str(input_path),
        "-b:v", str(video_bitrate), "-b:a", str(audio_bitrate),
        "-bufsize", str(video_bitrate * 2),
        str(output_path)
    ], capture_output=True)

    if result.returncode != 0 or not output_path.exists():
        return None
    return output_path


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hola! Mándame un link de YouTube y te descargo el video.\n\n"
        "Comandos:\n"
        "/video <url> — descarga el video en 720p (MP4)\n"
        "/audio <url> — descarga solo el audio en MP3\n\n"
        "O simplemente pega el link directamente."
    )


async def download_and_send(update: Update, url: str, audio_only: bool = False, from_callback=None):
    if from_callback:
        msg = from_callback
        reply = from_callback.message.reply_to_message or from_callback.message
        async def send_file(audio, video, filename):
            if audio_only:
                await reply.reply_audio(audio=audio, filename=filename)
            else:
                await reply.reply_video(video=video, filename=filename, supports_streaming=True)
    else:
        msg = await update.message.reply_text("⏳ Descargando... un momento.")
        async def send_file(audio, video, filename):
            if audio_only:
                await update.message.reply_audio(audio=audio, filename=filename)
            else:
                await update.message.reply_video(video=video, filename=filename, supports_streaming=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            cmd = ["yt-dlp", "--no-playlist"]

            if audio_only:
                cmd += ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
            else:
                cmd += [
                    "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
                    "--merge-output-format", "mp4",
                ]

            cmd += ["-o", f"{tmpdir}/%(title)s.%(ext)s", url]

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                error = result.stderr[-600:] if result.stderr else "Error desconocido"
                await msg.edit_text(f"Error al descargar:\n`{error}`", parse_mode="Markdown")
                return

            files = list(Path(tmpdir).iterdir())
            if not files:
                await msg.edit_text("No se encontró el archivo descargado.")
                return

            file_path = files[0]
            size_mb = file_path.stat().st_size / (1024 * 1024)

            if size_mb > MAX_SIZE_MB and not audio_only:
                await msg.edit_text(f"El video pesa {size_mb:.1f} MB, comprimiendo para que entre en Telegram...")
                file_path = compress_video(file_path, Path(tmpdir))
                if file_path is None:
                    await msg.edit_text("No se pudo comprimir el video lo suficiente.")
                    return
                size_mb = file_path.stat().st_size / (1024 * 1024)

            await msg.edit_text(f"📤 Enviando {file_path.name} ({size_mb:.1f} MB)...")

            with open(file_path, "rb") as f:
                await send_file(audio=f, video=f, filename=file_path.name)

            await msg.delete()

        except Exception as e:
            await msg.edit_text(f"Error inesperado: {e}")


async def cmd_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Uso: /video <url de YouTube>")
        return
    url = context.args[0]
    if not YOUTUBE_REGEX.match(url):
        await update.message.reply_text("Esa URL no parece ser de YouTube.")
        return
    await download_and_send(update, url, audio_only=False)


async def cmd_audio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Uso: /audio <url de YouTube>")
        return
    url = context.args[0]
    if not YOUTUBE_REGEX.match(url):
        await update.message.reply_text("Esa URL no parece ser de YouTube.")
        return
    await download_and_send(update, url, audio_only=True)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text or ""
    match = YOUTUBE_REGEX.search(text)
    if match:
        url = match.group(0)
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("🎬 Video (720p)", callback_data=f"video|{url}"),
                InlineKeyboardButton("🎵 Audio (MP3)", callback_data=f"audio|{url}"),
            ]
        ])
        await update.message.reply_text("¿Qué formato querés?", reply_markup=keyboard)
    else:
        await update.message.reply_text("No encontré un link de YouTube. Mándame uno y lo descargo.")


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    action, url = query.data.split("|", 1)
    await query.edit_message_text("⏳ Descargando... un momento.")
    await download_and_send(update, url, audio_only=(action == "audio"), from_callback=query)


def main():
    ensure_yt_dlp()
    start_health_server()
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("video", cmd_video))
    app.add_handler(CommandHandler("audio", cmd_audio))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(CallbackQueryHandler(handle_callback))
    print("Bot corriendo...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
