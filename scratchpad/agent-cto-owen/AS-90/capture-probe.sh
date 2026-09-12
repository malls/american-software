#!/bin/bash
# What headless capture can this host do with nothing new installed?
ls /Applications | grep -iE "chrom|firefox|safari|arc|brave|edge"
echo '--- bins on PATH'
for b in chromium chromium-browser google-chrome chrome firefox playwright wkhtmltoimage; do command -v "$b"; done
echo '--- Chrome app binary'
ls -d "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" 2>/dev/null
ls -d "/Applications/Chromium.app/Contents/MacOS/Chromium" 2>/dev/null
echo '--- playwright caches'
ls ~/.cache/ms-playwright 2>/dev/null; ls ~/Library/Caches/ms-playwright 2>/dev/null
echo '--- node / global npm'
node -v
npm ls -g --depth=0 2>/dev/null | grep -iE "playwright|puppeteer"
echo '--- c11'
echo "C11_SHELL_INTEGRATION=${C11_SHELL_INTEGRATION:-unset}"
echo '--- safari webdriver'
ls /usr/bin/safaridriver 2>/dev/null
