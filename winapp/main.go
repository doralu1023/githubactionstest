package main

import (
    "os"
    "os/exec"
    "path/filepath"
    "encoding/base64"
)

func main() {
    encoded := "__HTML_CONTENT_PLACEHOLDER__"
    decoded, _ := base64.StdEncoding.DecodeString(encoded)
    tmpDir := os.Getenv("TEMP")
    htmlPath := filepath.Join(tmpDir, "twec_tool_live.html")
    _ = os.WriteFile(htmlPath, decoded, 0644)
    cmd := exec.Command("cmd", "/c", "start", "msedge", "--app="+htmlPath)
    _ = cmd.Start()
}