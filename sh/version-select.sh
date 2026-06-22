#!/bin/bash

# Function to extract current version from package.json using awk
get_current_version() {
    version=$(awk -F\" '/"version":/ {print $4}' package.json)
    echo $version
}

# Function to update version in package.json example: "version": "0.1.113",
update_version() {
    old_version=$(get_current_version)
    new_version=$1
    # Check if running on macOS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS requires an extension with -i flag
        # replace old version with new version "version": "0.1.113",
        sed -i '' "s/\"version\": \"$old_version\"/\"version\": \"$new_version\"/" package.json
    else
        # Linux version
        sed -i "s/\"version\": \"$old_version\"/\"version\": \"$new_version\"/" package.json
    fi
    if [ $? -ne 0 ]; then
        echo "Failed to update package.json version. Exiting."
        exit 1
    fi
}
# Function to update CHANGELOG.md
update_changelog() {
    new_version=$1
    changelog_entries=$2
    
    # Create temporary file with new content
    echo -e "## $new_version\n" > temp_changelog
    echo -e "$changelog_entries\n" >> temp_changelog
    cat CHANGELOG.md >> temp_changelog
    mv temp_changelog CHANGELOG.md
}

# Function to increment version
increment_version() {
    current=$1
    type=$2
    
    IFS='.' read -ra ADDR <<< "$current"
    major="${ADDR[0]}"
    minor="${ADDR[1]}"
    patch="${ADDR[2]}"
    
    case $type in
        "major")
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        "minor")
            minor=$((minor + 1))
            patch=0
            ;;
        "patch")
            patch=$((patch + 1))
            ;;
    esac
    
    echo "$major.$minor.$patch"
}

# Main script
current_version=$(get_current_version)
echo "Current version: $current_version"
echo "Select version update type:"
echo "1) Major (x.0.0)"
echo "2) Minor (0.x.0)"
echo "3) Patch (0.0.x)"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        new_version=$(increment_version "$current_version" "major")
        ;;
    2)
        new_version=$(increment_version "$current_version" "minor")
        ;;
    3)
        new_version=$(increment_version "$current_version" "patch")
        ;;
    *)
        echo "No choice selected. Exiting."
        exit 1
        ;;
esac

echo "Updating to version (from package.json): $new_version"

# Collect changelog entries
echo "Enter changelog entries (press Enter with no input when done):"
changelog_entries=""
while true; do
    read -p "- " entry
    if [ -z "$entry" ]; then
        break
    fi
    changelog_entries+="- $entry\n"
done

# Update all files
update_version "$new_version"
update_changelog "$new_version" "$changelog_entries"

echo "Version updated successfully!"
echo "- package.json: $(get_current_version)"
echo "- CHANGELOG.md updated with new entries" 