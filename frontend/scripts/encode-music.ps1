# Encode les pistes WAV générées par `node scripts/generate-music.mjs` en AAC (.m4a) avec
# l'encodeur AAC intégré à Windows (Media Foundation, via Windows.Media.Transcoding) : aucun
# outil à installer, aucune dépendance ajoutée à l'application.
#
#   powershell -ExecutionPolicy Bypass -File scripts/encode-music.ps1 [-Bitrate 96000]
#
# Lancé seul, il produit des .m4a SANS liste d'édition (trou audible à chaque tour de boucle) :
# passer par `node scripts/generate-music.mjs`.
#
# Entrée  : audio-src/music/*.wav (sources de travail, non embarquées, ignorées par git)
# Sortie  : assets/audio/music/*.m4a (déclarées dans MUSIC_TRACKS, expo-music-player.ts)
# Appelé par `node scripts/generate-music.mjs`, qui ajoute ensuite la liste d'édition MP4.
param(
  [string]$Source = (Join-Path $PSScriptRoot '..\audio-src\music'),
  [string]$Target = (Join-Path $PSScriptRoot '..\assets\audio\music'),
  # 96 kbit/s mono : basses, percussions et arpèges restent nets ; ~12 Ko par seconde.
  # L'encodeur de Windows n'accepte que 96, 128, 160 ou 192 kbit/s, et seulement à 44,1 ou
  # 48 kHz : à 22 050 Hz il impose 32 kbit/s, trop pauvre pour les cymbales.
  [uint32]$Bitrate = 96000
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$asTaskAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 2 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1'
} | Select-Object -First 1

function Await($operation, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  $task.Result
}
function AwaitProgress($operation) {
  $task = $asTaskAction.MakeGenericMethod([double]).Invoke($null, @($operation, $null))
  $task.Wait() | Out-Null
}

if (-not (Test-Path $Source)) { throw "Sources absentes : $Source (lancer d'abord node scripts/generate-music.mjs)" }
New-Item -ItemType Directory -Force $Target | Out-Null
$Source = (Resolve-Path $Source).Path
$Target = (Resolve-Path $Target).Path
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($Target)) ([Windows.Storage.StorageFolder])
$transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder

foreach ($wav in Get-ChildItem $Source -Filter *.wav | Sort-Object Name) {
  $profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateM4a([Windows.Media.MediaProperties.AudioEncodingQuality]::High)
  $profile.Audio.Bitrate = $Bitrate
  $profile.Audio.ChannelCount = 1
  $profile.Audio.SampleRate = 44100
  $profile.Video = $null
  $inFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($wav.FullName)) ([Windows.Storage.StorageFile])
  $name = [IO.Path]::ChangeExtension($wav.Name, '.m4a')
  $outFile = Await ($folder.CreateFileAsync($name, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $prepared = Await ($transcoder.PrepareFileTranscodeAsync($inFile, $outFile, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
  if (-not $prepared.CanTranscode) { throw "Encodage impossible pour $($wav.Name) : $($prepared.FailureReason)" }
  AwaitProgress ($prepared.TranscodeAsync())
  $size = (Get-Item (Join-Path $Target $name)).Length
  Write-Output ("{0} : {1} Ko" -f $name, [math]::Round($size / 1024))
}
