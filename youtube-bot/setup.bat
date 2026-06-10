@echo off
echo ====================================
echo  Instalando Bot de YouTube
echo ====================================

:: Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo Python no encontrado. Descargando...
    curl -o python_installer.exe https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
    python_installer.exe /quiet InstallAllUsers=1 PrependPath=1
    del python_installer.exe
    echo Python instalado. Reiniciando setup...
    pause
    exit
)

:: Crear carpeta en E:
if not exist "E:\bot-youtube" mkdir "E:\bot-youtube"
cd /d "E:\bot-youtube"

:: Clonar o actualizar repo
if exist ".git" (
    echo Actualizando codigo...
    git pull origin main
) else (
    echo Descargando codigo...
    git clone https://github.com/NR213z/botyt1.git .
)

:: Instalar dependencias
echo Instalando dependencias...
pip install -r requirements.txt

:: Guardar token
setx BOT_TOKEN "8867909739:AAEJD64npCe-LEV8E4ZyrOYuDcVf1YEqJ08"

:: Crear acceso directo en inicio de Windows para arranque automatico
echo Configurando inicio automatico...
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
copy "%~dp0iniciar_bot.bat" "%STARTUP%\iniciar_bot.bat" >nul 2>&1

echo.
echo ====================================
echo  Instalacion completa!
echo  Ejecuta iniciar_bot.bat para correr el bot
echo ====================================
pause
