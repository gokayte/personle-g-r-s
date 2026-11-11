Add-Type -AssemblyName System.Drawing
$userUpload = "C:\Users\Gokay\.gemini\antigravity\brain\66fbff9b-b4f0-4583-a0d8-4b2bbd408fab\.user_uploaded\media_1794423611510_3fe19a1e.png"
$src = [System.Drawing.Image]::FromFile($userUpload)

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Background: match dark slate / black #0b0d13 or white depending on transparency
# Let's inspect source format or use dark theme matching app background #0b0d13
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 13, 19))
$g.FillRectangle($bgBrush, 0, 0, $size, $size)

# Scale src to fit nicely within 512x512 with good padding (e.g. 380px)
$scale = [Math]::Min(380.0 / $src.Width, 380.0 / $src.Height)
$w = [int]($src.Width * $scale)
$h = [int]($src.Height * $scale)
$x = [int](($size - $w) / 2)
$y = [int](($size - $h) / 2)

$g.DrawImage($src, $x, $y, $w, $h)

$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\apple-touch-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
# Also copy the raw uploaded logo to public
Copy-Item -Path $userUpload -Destination "C:\Users\Gokay\Desktop\personel-pdks\public\user-star-logo.png" -Force

$src.Dispose()
$bmp.Dispose()
$g.Dispose()
Write-Host "Uploaded logo icon generated successfully!"
