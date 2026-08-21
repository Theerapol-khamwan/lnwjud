@echo off
chcp 65001 >nul
title lnwjud Secure Tunnel
if exist "%~dp0start-lnwjud-tunnel.ps1" (
  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0start-lnwjud-tunnel.ps1" -OpenDashboard
) else (
  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%USERPROFILE%\Downloads\tunnel\start-lnwjud-tunnel.ps1" -OpenDashboard
)
if errorlevel 1 pause
