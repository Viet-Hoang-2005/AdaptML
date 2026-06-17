@echo off
cd /d "%~dp0..\web"
npm.cmd run dev -- --host 0.0.0.0
