#!/bin/bash
mkdir -p ~/log/_data/logbook
cd ~/log
git pull origin main
cp ~/.signalk/plugin-config-data/signalk-logbook/* ~/log/_data/logbook
if [ -z "$(git status --porcelain)" ]; then exit 0;fi
git add _data/logbook/*
git commit -m "Backup logbook entries"
git push origin main
