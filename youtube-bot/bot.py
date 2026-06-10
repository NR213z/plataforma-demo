#!/usr/bin/env python3
import asyncio
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes

TOKEN = os.environ["BOT_TOKEN"]
PORT = int(os.environ.get("PORT", 8080))
COOKIES_FILE = "/tmp/yt_cookies.txt"

YOUTUBE_REGEX = re.compile(
    r'https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-?=&]+'
)

MAX_SIZE_MB = 50
PROGRESS_INTERVAL = 6

download_queue: asyncio.Queue = asyncio.Queue()
queue_size: int = 0


def ensure_yt_dlp():
    print("Actualizando yt-dlp...")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--break-system-packages", "-U", "yt-dlp"],
        check=True,
    )


def setup_cookies():
    cookies = os.environ.get("YOUTUBE_COOKIES", "")
    if cookies:
        with open(COOKIES_FILE, "w") as f:
            f.write(cookies)
        print("Cookies de YouTube cargadas.")


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")

    def log_message(self, *args):
        pass


def start_health_server():
    server = HTTPServer(("0.0.0.0", PORT), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Health server corriendo en puerto {PORT}")


def compress_video(input_path: Path, tmpdir: Path) -> Path | None:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)],
        capture_output=True, text=True
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        return None

    target_bytes = 49 * 1024 * 1024
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


async def run_download_with_progress(cmd: list, msg) -> tuple[int, str]:
    """Ejecuta yt-dlp y actualiza el mensaje con el progreso cada N segundos."""
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    last_update = time.time()
    stderr_lines = []
    progress_line = ""

    while True:
        line_bytes = await process.stdout.readline()
        if not line_bytes:
            break
        line = line_bytes.decode("utf-8", errors="ignore").strip()
        stderr_lines.append(line)

        if "[download]" in line and "%" in line:
            progress_line = line
            now = time.time()
            if now - last_update >= PROGRESS_INTERVAL:
                try:
                    await msg.edit_text(f"⏳ {progress_line}")
                    last_update = now
                except Exception:
                    pass

    await process.wait()
    return process.returncode, "\n".join(stderr_lines[-20:])


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
        msg = from_callback  # ya es un Message
        reply = msg
    else:
        msg = await update.message.reply_text("⏳ Descargando... un momento.")
        reply = update.message

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            cmd = [
                "yt-dlp", "--no-playlist", "--newline",
                "--extractor-args", "youtube:player_client=tv_embedded,ios,web",
            ]
            if os.path.exists(COOKIES_FILE):
                cmd += ["--cookies", COOKIES_FILE]

            if audio_only:
                cmd += ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
            else:
                cmd += [
                    "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
                    "--merge-output-format", "mp4",
                ]

            cmd += ["-o", f"{tmpdir}/%(title)s.%(ext)s", url]

            returncode, output = await run_download_with_progress(cmd, msg)

            if returncode != 0:
                await msg.edit_text(f"Error al descargar:\n`{output[-500:]}`", parse_mode="Markdown")
                return

            files = list(Path(tmpdir).iterdir())
            if not files:
                await msg.edit_text("No se encontró el archivo descargado.")
                return

            file_path = files[0]
            size_mb = file_path.stat().st_size / (1024 * 1024)

            if size_mb > MAX_SIZE_MB and not audio_only:
                await msg.edit_text(f"📦 El video pesa {size_mb:.1f} MB, comprimiendo para que entre en Telegram...")
                file_path = compress_video(file_path, Path(tmpdir))
                if file_path is None:
                    await msg.edit_text("No se pudo comprimir el video lo suficiente.")
                    return
                size_mb = file_path.stat().st_size / (1024 * 1024)

            await msg.edit_text(f"📤 Enviando {file_path.name} ({size_mb:.1f} MB)...")

            with open(file_path, "rb") as f:
                if audio_only:
                    await reply.reply_audio(audio=f, filename=file_path.name)
                else:
                    await reply.reply_video(video=f, filename=file_path.name, supports_streaming=True)

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
    global queue_size
    query = update.callback_query
    await query.answer()
    action, url = query.data.split("|", 1)
    msg = query.message  # objeto Message real

    queue_size += 1
    pos = download_queue.qsize()
    if pos > 0:
        await msg.edit_text(f"🕐 Hay {pos} descarga(s) antes que la tuya. Esperá un momento...")
    else:
        await msg.edit_text("⏳ Descargando... un momento.")

    await download_queue.put((update, url, action == "audio", msg))


async def download_worker():
    global queue_size
    while True:
        update, url, audio_only, msg = await download_queue.get()
        try:
            await download_and_send(update, url, audio_only=audio_only, from_callback=msg)
        except Exception as e:
            try:
                await msg.edit_text(f"Error inesperado: {e}")
            except Exception:
                pass
        finally:
            queue_size -= 1
            download_queue.task_done()


def main():
    global download_queue
    ensure_yt_dlp()
    setup_cookies()
    start_health_server()

    async def post_init(app):
        asyncio.create_task(download_worker())

    app = Application.builder().token(TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("video", cmd_video))
    app.add_handler(CommandHandler("audio", cmd_audio))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(CallbackQueryHandler(handle_callback))
    print("Bot corriendo...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
