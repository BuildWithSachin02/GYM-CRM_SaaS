"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type QrDisplayProps = {
  token: string
  origin: string
}

export function QrDisplay({ token, origin }: QrDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const qrUrl = `${origin}/attendance/qr/${token}`

  useEffect(() => {
    QRCode.toDataURL(qrUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then(setDataUrl)
      .catch(() => {
        setDataUrl(null)
      })
  }, [qrUrl])

  return (
    <Card className="inline-block">
      <CardHeader>
        <CardTitle>Scan to Check In</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="QR Code for attendance check-in"
            className="rounded-lg border"
            width={256}
            height={256}
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
            Generating QR code...
          </div>
        )}
        <p className="max-w-xs break-all text-center text-xs text-muted-foreground">
          {qrUrl}
        </p>
      </CardContent>
    </Card>
  )
}
