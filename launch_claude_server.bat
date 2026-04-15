@echo off
REM ============================================================
REM  Full Stack Launcher - FastAPI Server + Claude Code
REM  Starts the FastAPI backend, React frontend, then Claude Code
REM ============================================================

title CT Pipeline - Full Stack Launcher

echo.
echo  ===================================================
echo   Full Stack Launcher
echo   Project: CT Collection Threshold Learning
echo  ===================================================
echo.

cd /d "F:\Master_Python_Scripts\CT_Collection_Threshold_Learning"
call venv\Scripts\activate.bat

REM Start FastAPI server in background
echo  [1/3] Starting FastAPI server on port 8000...
start "FastAPI Server" cmd /k "cd /d F:\Master_Python_Scripts\CT_Collection_Threshold_Learning && call venv\Scripts\activate.bat && uvicorn api.main:app --reload --port 8000"

REM Give the server a moment to start
timeout /t 3 /nobreak >nul

REM Start React frontend in background
echo  [2/3] Starting React frontend on port 5173...
start "React Frontend" cmd /k "cd /d F:\Master_Python_Scripts\CT_Collection_Threshold_Learning\frontend && npm run dev"

timeout /t 2 /nobreak >nul

REM Launch Claude Code
echo  [3/3] Starting Claude Code...
echo.
echo  Once inside, type /remote-control to connect your iPhone.
echo.
claude

echo.
echo  Claude Code session ended.
echo  Note: FastAPI server and React frontend are still running
echo  in their own windows. Close them manually when done.
pause
