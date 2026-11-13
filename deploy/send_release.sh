#!/usr/bin/env bash
set -euo pipefail
umask 077
revision=${RELEASE_REVISION:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$temporary/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$temporary/known_hosts"
chmod 600 "$temporary/key" "$temporary/known_hosts"
for kind in api worker frontend; do
  variable="${kind^^}_SOURCE"
  image=${!variable:?Verified image digest required}
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || exit 1
  docker pull "$image"
  docker tag "$image" "firebridge-webapp-${kind}:${revision}"
done
docker save "firebridge-webapp-api:$revision" "firebridge-webapp-worker:$revision" "firebridge-webapp-frontend:$revision" | gzip -1 > "$temporary/images.tar.gz"
checksum=$(sha256sum "$temporary/images.tar.gz" | cut -d ' ' -f 1)
ssh_options=(-i "$temporary/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$temporary/known_hosts" -o ServerAliveInterval=30 -o ServerAliveCountMax=10)
ssh "${ssh_options[@]}" "firebridge-webapp-deploy@$DEPLOY_HOST" "images $revision $checksum" < "$temporary/images.tar.gz"
ssh "${ssh_options[@]}" "firebridge-webapp-deploy@$DEPLOY_HOST" "activate $revision"
ssh "${ssh_options[@]}" "firebridge-webapp-deploy@$DEPLOY_HOST" status
