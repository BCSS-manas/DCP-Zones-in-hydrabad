@echo off
echo ============================================
echo  Telangana Police Map - Build Script
echo ============================================
echo.
echo Extracting GeoJSON boundaries from reference file...
node build_data.js
echo.
echo Opening map in browser...
start index.html
echo.
echo Done! The map should open in your default browser.
pause
