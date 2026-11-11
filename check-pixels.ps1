Add-Type -AssemblyName System.Drawing
$b = New-Object System.Drawing.Bitmap('C:\Users\Gokay\Desktop\personel-pdks\public\user-star-logo.png')
$c1 = $b.GetPixel(0, 0)
$c2 = $b.GetPixel([int]($b.Width/2), [int]($b.Height/2))
$c3 = $b.GetPixel(5, 5)
Write-Host ("TopLeft: Alpha=" + $c1.A + " R=" + $c1.R + " G=" + $c1.G + " B=" + $c1.B)
Write-Host ("Center: Alpha=" + $c2.A + " R=" + $c2.R + " G=" + $c2.G + " B=" + $c2.B)
$b.Dispose()
