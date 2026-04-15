@echo off
REM ============================================================
REM  Claude Code Launcher - CT Collection Threshold Learning
REM ============================================================
REM
REM  Usage:
REM    Double-click this file, or run from terminal:
REM      launch_claude.bat
REM
REM  What this does:
REM    1. Opens Claude Code in this project directory
REM    2. Once inside, type /remote-control to connect your iPhone
REM
REM ============================================================

title Claude Code - CT Pipeline

echo.
echo  ===================================================
echo   Claude Code Launcher
echo   Project: CT Collection Threshold Learning
echo  ===================================================
echo.
echo  After Claude Code starts:
echo.
echo    REMOTE CONTROL (approve prompts from iPhone):
echo      Type /remote-control inside the session
echo      Scan the QR code with your iPhone
echo.
echo    DISPATCH (send new tasks from iPhone):
echo      Open Claude Desktop app on your PC
echo      Dispatch is managed through Claude Desktop
echo.
echo  ===================================================
echo.

cd /d "F:\Master_Python_Scripts\CT_Collection_Threshold_Learning"

REM Activate the virtual environment for Python access
call venv\Scripts\activate.bat

REM Launch Claude Code in the project directory
claude

REM If Claude exits, pause so the window stays open
echo.
echo  Claude Code session ended.
pause
