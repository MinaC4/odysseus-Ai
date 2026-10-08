# Odysseus on the home K3s cluster

The Argo CD application installs one Odysseus replica, ChromaDB, SearXNG, and
ntfy in the dedicated `odysseus` namespace. SQLite and all app data stay on its
own `local-path` PVC. The app image is pinned to the immutable image built from
source commit `a8c147b`.

## First deploy

Create the namespace and runtime secrets once, then install the Argo CD app:

```sh
kubectl create namespace odysseus
kubectl -n odysseus create secret generic odysseus-runtime \
  --from-literal=admin-password="$(openssl rand -hex 24)" \
  --from-literal=searxng-secret="$(openssl rand -hex 32)"
kubectl apply -f deploy/k3s/odysseus/application.yaml
```

The secret is intentionally kept out of Git. To retrieve the first admin
password after Argo CD reports the application healthy:

```sh
kubectl -n odysseus get secret odysseus-runtime \
  -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

## Access

Open `http://odysseus.192.168.1.8.nip.io` from a device on the same LAN. Login
as `admin` with the password above. Auth is enabled and localhost bypass is
disabled. The ingress is HTTP because the cluster has no certificate for this
hostname; use it only on a trusted LAN or put it behind a trusted HTTPS proxy.

Only Odysseus is exposed through Traefik. ChromaDB, SearXNG, and ntfy remain
cluster-internal. Configure an external model provider in Settings; this
cluster has no GPU capacity reserved for local model serving. Small CPU models
may work, but large model downloads and serving will need more disk and memory.
