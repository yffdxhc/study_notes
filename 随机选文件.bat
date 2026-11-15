@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem ============================================================
rem  随机抽取一个文件（会递归进入所有子文件夹）
rem  抽中的是视频文件时会自动用默认播放器打开
rem
rem  用法：
rem    随机选文件.bat                        在“当前文件夹”递归随机选一个文件
rem    随机选文件.bat "D:\音乐"              在指定文件夹递归随机选
rem    随机选文件.bat "D:\音乐" "*.mp3"      只从 mp3 里选（写 mp3 或 .mp3 也行）
rem    随机选文件.bat "D:\视频" "*.mp4"      抽中视频会自动播放
rem    随机选文件.bat "D:\音乐" open          不管什么类型都直接打开
rem ============================================================

rem --- 哪些扩展名算视频（想增减就改这一行）---
set "videoexts=mp4 mkv avi mov wmv flv rmvb rm m4v ts mpg mpeg webm 3gp f4v m2ts mts vob asf ogv divx m2v"

set "root=%~1"
set "mask=%~2"
set "after=%~3"

rem --- open 写在第 2 个参数位置时也认，把它挪到最后 ---
if /i "%mask%"=="open" (
    set "mask=%after%"
    set "after=open"
)

if not defined root set "root=."
if not defined mask set "mask=*"

rem --- 目录转成绝对路径，顺便去掉末尾多余的反斜杠 ---
for %%A in ("%root%") do set "root=%%~fA"
if not exist "%root%\" (
    for /f "delims=" %%P in ("%root%") do echo [错误] 找不到这个文件夹：%%P
    call :maybe_pause
    exit /b 1
)

rem --- 只写扩展名也能用：mp3 / .mp3 都会当成 *.mp3 ---
if "%mask:~0,1%"=="." set "mask=*%mask%"
if not "%mask:~0,1%"=="*" if not "%mask:~0,1%"=="?" if "%mask:.=%"=="%mask%" set "mask=*.%mask%"

if "%root:~-1%"=="\" (
    set "pattern=%root%%mask%"
) else (
    set "pattern=%root%\%mask%"
)

rem --- 递归列出全部文件：/s 进子目录  /b 只输出路径  /a-d 排除文件夹 ---
rem   第一行故意写一行占位内容，后面跳过行数就从 1 开始，避开 skip=0 的怪问题
set "list=%TEMP%\rndfile_%RANDOM%%RANDOM%.tmp"
echo __dummy__>"%list%"
dir /s /b /a-d "%pattern%" >>"%list%" 2>nul

rem --- 数一数有多少个（减掉第一行占位）---
set "count=0"
for /f "usebackq delims=" %%L in ("%list%") do set /a count+=1
set /a "count-=1"

if %count% leq 0 (
    del "%list%" >nul 2>nul
    for /f "delims=" %%P in ("%pattern%") do echo [提示] 没有找到任何符合条件的文件：%%P
    call :maybe_pause
    exit /b 1
)

rem --- 随机选中第 n 个 ---
rem   RANDOM 在连续启动时种子几乎一样，所以再混入当前时间的百分秒
set /a "cs=1%TIME:~-2%-100"
set /a "pick=((%RANDOM% * 32768 + %RANDOM%) + cs * 1013) %% count + 1"
set /a "skip=pick"
set "picked="
for /f "usebackq delims= skip=%skip%" %%L in ("%list%") do (
    set "picked=%%L"
    goto :picked
)
:picked
del "%list%" >nul 2>nul

if not defined picked (
    echo [错误] 抽取失败，请重试。
    call :maybe_pause
    exit /b 1
)

echo 共 %count% 个文件，本次随机选中：
rem   用 for /f 中转输出，文件名里带 & 或 % 也不会被当成命令
for /f "delims=" %%P in ("%picked%") do echo %%P

rem --- 抽中的是视频就直接播放；参数里写了 open 则任何类型都打开 ---
set "ext="
for %%F in ("%picked%") do set "ext=%%~xF"
set "isvideo="
for %%E in (%videoexts%) do if /i ".%%E"=="%ext%" set "isvideo=1"

set "tolaunch="
if defined isvideo set "tolaunch=1"
if /i "%after%"=="open" set "tolaunch=1"

if defined isvideo echo 是视频文件，正在用默认播放器打开……
if defined tolaunch start "" "%picked%"

call :maybe_pause
exit /b 0

rem ============================================================
rem  子过程：双击运行时窗口会一闪而过，这里停一下等用户看清结果；
rem  从命令行 / 被别的脚本调用时不暂停，避免卡住后台流程。
rem  判断依据：双击时 cmd 的启动命令里带着本脚本的文件名。
rem ============================================================
:maybe_pause
echo "%cmdcmdline%" | find /i "%~nx0" >nul
if not errorlevel 1 pause
goto :eof
