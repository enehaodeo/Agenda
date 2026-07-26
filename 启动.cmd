@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器 http://localhost:5177 ...
start "" http://localhost:5177
python -m http.server 5177
pause
