@echo off
setlocal
pushd "%~dp0" || exit /b 1
node apps-script\build.mjs
if errorlevel 1 goto failed
node scripts\serve-roadmap.mjs
if errorlevel 1 goto failed
popd
exit /b 0

:failed
echo.
echo The planner could not start. See the message above.
pause
popd
exit /b 1
