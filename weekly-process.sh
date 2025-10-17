#!/bin/bash

# Weekly data processing script
# This script runs the npm process and commits/pushes any changes

cd /Volumes/datastore/repos/fish-facts-and-data

# Run the npm process
echo "$(date): Starting weekly data process..."
npm run process

# Check if there are any changes to commit
if [[ -n $(git status --porcelain) ]]; then
    echo "$(date): Changes detected, committing and pushing..."
    git add .
    git commit -m "Weekly data update - $(date '+%Y-%m-%d %H:%M:%S')"
    git push
    echo "$(date): Process completed and changes pushed."
else
    echo "$(date): No changes to commit."
fi

echo "$(date): Weekly process finished."