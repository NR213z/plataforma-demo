@echo off
cd /d "E:\bot-youtube"
title Bot YouTube - Corriendo
echo Bot iniciando...
python main.py
if errorlevel 1 (
    echo El bot se cerro con un error. Reiniciando en 5 segundos...
    timeout /t 5
    goto :inicio
)
:inicio
python main.py
