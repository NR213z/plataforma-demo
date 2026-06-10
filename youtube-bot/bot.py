#!/usr/bin/env python3
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

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


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hola! Mándame un link de YouTube y te descargo el video.\n\n"
        "Comandos:\n"
        "/video <url> — descarga el video en 720p (MP4)\n"
        "/audio <url> — descarga solo el audio en MP3\n\n"
        "O simplemente pega el link directamente."
    )


async def download_and_send(update: Update, url: str, audio_only: bool = False):
    msg = await update.message.reply_text("⏳ Descargando... un momento.")

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

            if size_mb > MAX_SIZE_MB:
                await msg.edit_text(
                    f"El archivo pesa {size_mb:.1f} MB y supera el límite de {MAX_SIZE_MB} MB de Telegram. "
                    f"Intenta con una calidad menor usando /video."
                )
                return

            await msg.edit_text(f"📤 Enviando {file_path.name} ({size_mb:.1f} MB)...")

            with open(file_path, "rb") as f:
                if audio_only:
                    await update.message.reply_audio(audio=f, filename=file_path.name)
                else:
                    await update.message.reply_video(
                        video=f,
                        filename=file_path.name,
                        supports_streaming=True,
                    )

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
        await download_and_send(update, match.group(0))
    else:
        await update.message.reply_text("No encontré un link de YouTube. Mándame uno y lo descargo.")


def main():
    ensure_yt_dlp()
    start_health_server()
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("video", cmd_video))
    app.add_handler(CommandHandler("audio", cmd_audio))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    print("Bot corriendo...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
