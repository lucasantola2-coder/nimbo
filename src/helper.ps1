# Nimbo - proceso auxiliar de Windows.
# Lee comandos JSON (uno por linea) por stdin y responde JSON por stdout.
# Si Nimbo se cierra (o se cuelga), stdin se cierra y este script restaura la barra de tareas.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path (Join-Path $PSScriptRoot 'NimboWin.cs') -ReferencedAssemblies System.Drawing

# ---- Musica (controles multimedia de Windows / WinRT) ----
$script:media = $null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
    function Await($op, [Type]$type) {
        $t = $script:asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
        $t.Wait(3000) | Out-Null
        return $t.Result
    }
    $script:media = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { $script:media = $null }

$script:lastArtKey = ''
$script:lastArt = $null

function Get-NowPlaying {
    if (-not $script:media) { return $null }
    $s = $script:media.GetCurrentSession()
    if (-not $s) { return $null }
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $info = $s.GetPlaybackInfo()
    $key = "$($p.Title)|$($p.Artist)"
    if ($key -ne $script:lastArtKey) {
        $script:lastArtKey = $key
        $script:lastArt = $null
        try {
            if ($p.Thumbnail) {
                $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
                $ms = New-Object System.IO.MemoryStream
                $net.CopyTo($ms)
                $script:lastArt = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray())
                $net.Dispose()
            }
        } catch { $script:lastArt = $null }
    }
    $tl = $s.GetTimelineProperties()
    return @{
        title    = $p.Title
        artist   = $p.Artist
        album    = $p.AlbumTitle
        app      = $s.SourceAppUserModelId
        playing  = ($info.PlaybackStatus.ToString() -eq 'Playing')
        position = $tl.Position.TotalSeconds
        duration = $tl.EndTime.TotalSeconds
        art      = $script:lastArt
    }
}

function Invoke-Media($action) {
    if (-not $script:media) { return $false }
    $s = $script:media.GetCurrentSession()
    if (-not $s) {
        # sin sesion: usar teclas multimedia
        switch ($action) { 'toggle' { [NimboWin]::Key(0xB3) } 'next' { [NimboWin]::Key(0xB0) } 'prev' { [NimboWin]::Key(0xB1) } }
        return $true
    }
    switch ($action) {
        'toggle' { $op = $s.TryTogglePlayPauseAsync() }
        'play'   { $op = $s.TryPlayAsync() }
        'pause'  { $op = $s.TryPauseAsync() }
        'next'   { $op = $s.TrySkipNextAsync() }
        'prev'   { $op = $s.TrySkipPreviousAsync() }
    }
    return (Await $op ([bool]))
}

function Get-Apps {
    $sh = New-Object -ComObject Shell.Application
    $folder = $sh.NameSpace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}')   # shell:AppsFolder
    $skip = '(?i)(uninstall|desinstal|readme|l[eé]ame|help|ayuda|documentation|website|sitio web)'
    $apps = @()
    foreach ($it in $folder.Items()) {
        $id = $it.Path
        if (-not $id) { continue }
        if ($it.Name -match $skip) { continue }
        if ($id -match '(?i)\.(url|chm|txt|pdf|html?|ini|log|msc)$') { continue }
        $apps += @{ name = $it.Name; id = $id }
    }
    return $apps
}

function Send($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
}

$selfPid = [long]$args[0]
Send @{ id = 0; ok = $true; result = 'ready' }

try {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ($line.Trim() -eq '') { continue }
        $req = $null
        try {
            $req = $line | ConvertFrom-Json
            $a = $req.args
            $res = switch ($req.cmd) {
                'windows'        { @{ windows = @([NimboWin]::ListWindows($selfPid)); fullscreen = [NimboWin]::FullscreenApp($selfPid); remote = [NimboWin]::IsRemoteSession() } }
                'focus'          { [NimboWin]::Focus([long]$a.hwnd); $true }
                'minimize'       { [NimboWin]::Minimize([long]$a.hwnd); $true }
                'close'          { [NimboWin]::Close([long]$a.hwnd); $true }
                'round'          { [NimboWin]::RoundCorners([long]$a.hwnd); $true }
                'key'            { [NimboWin]::Key([byte]$a.vk); $true }
                'startMenu'      { [NimboWin]::Key(0x5B); $true }
                'keys'           { [NimboWin]::Keys([byte[]]@($a.vks | ForEach-Object { [byte]$_ })); $true }
                'taskbar'        {
                    switch ($a.mode) {
                        'autohide' { [NimboWin]::SetTaskbarVisible($true); [NimboWin]::SetTaskbarAutoHide($true) }
                        'hide'     { [NimboWin]::SetTaskbarAutoHide($true); [NimboWin]::SetTaskbarVisible($false) }
                        default    { [NimboWin]::RestoreTaskbar() }
                    }
                    $true
                }
                'appbar'         { $r = [NimboWin]::AppBarSet([long]$a.hwnd, [int]$a.left, [int]$a.top, [int]$a.right, [int]$a.bottom); @{ rect = $r } }
                'appbarRemove'   { [NimboWin]::AppBarRemoveAll(); $true }
                'remote'         { [NimboWin]::IsRemoteSession() }
                'recycle'        { $r = [NimboWin]::RecycleBin(); @{ count = $r[0]; size = $r[1] } }
                'emptyRecycle'   { [NimboWin]::EmptyRecycleBin(); $true }
                'drives'         { @{ drives = @([NimboWin]::Drives()) } }
                'net'            { $r = [NimboWin]::NetBytes(); @{ rx = $r[0]; tx = $r[1] } }
                'nowPlaying'     { Get-NowPlaying }
                'icons'          {
                    $out = @{}
                    foreach ($p in $a.paths) { $out[$p] = [NimboWin]::Icon([string]$p, [int]$a.size) }
                    @{ icons = $out }
                }
                'links'          { @{ links = @($a.paths | ForEach-Object { [NimboWin]::Link([string]$_) }) } }
                'apps'           { @{ apps = @(Get-Apps) } }
                'media'          { Invoke-Media $a.action }
                default          { throw "comando desconocido: $($req.cmd)" }
            }
            Send @{ id = $req.id; ok = $true; result = $res }
        } catch {
            $rid = 0; if ($req) { $rid = $req.id }
            Send @{ id = $rid; ok = $false; error = $_.Exception.Message }
        }
    }
} finally {
    [NimboWin]::AppBarRemoveAll()
    [NimboWin]::RestoreTaskbar()
}
