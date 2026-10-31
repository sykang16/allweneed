@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo Python이 설치되어 있지 않습니다. docs\사용자매뉴얼.md 2장을 참고하세요. & pause & exit /b 1)
python serve.py
pause
