# RPCaaS Deployment Guide

## Prerequisites

- **node-uk1** (Kimsufi KS-LE-B, London) with:
  - Ubuntu 22.04 LTS
  - 2x 2TB HDD (/dev/sda for OS, /dev/sdb for chain data)
  - k3s agent installed and joined to cluster
  - Node labeled: `kubectl label node node-uk1 role=rpc`
- **k3s cluster** with Helm 3 installed
- **Cloudflare account** with tunnel configured
- **Docker Hub** access for `opsalis/rpcaas-proxy` image

## Step 1: Prepare Disk on node-uk1

```bash
# SSH to node-uk1
ssh root@node-uk1

# Partition /dev/sdb (if not already done)
# Create single ext4 partition spanning full disk
fdisk /dev/sdb
# n, p, 1, default, default, w

mkfs.ext4 /dev/sdb1

# Create mount point and chain directories
mkdir -p /mnt/chains
mount /dev/sdb1 /mnt/chains

# Add to fstab for persistence
echo '/dev/sdb1 /mnt/chains ext4 defaults 0 2' >> /etc/fstab

# Create per-chain directories
mkdir -p /mnt/chains/{base,optimism,arbitrum,polygon,ethereum}
mkdir -p /mnt/minio

# Verify disk space
df -h /mnt/chains
# Should show ~1.8TB available
```

## Step 2: Join node-uk1 to k3s Cluster

```bash
# On the k3s server, get the join token
cat /var/lib/rancher/k3s/server/node-token

# On node-uk1, install k3s agent
curl -sfL https://get.k3s.io | K3S_URL=https://k3s-server:6443 K3S_TOKEN=<token> sh -

# On k3s server, label the node
kubectl label node node-uk1 role=rpc

# Create the rpcaas namespace
kubectl create namespace rpcaas
```

## Step 3: Deploy Ethereum Node (First — Others Depend on It)

```bash
# From the RPCaaS project root
cd nodes/ethereum

# Install Helm chart
helm install ethereum-node . \
  --namespace rpcaas \
  --set persistence.hostPath=/mnt/chains/ethereum

# Monitor sync progress
kubectl logs -f -n rpcaas deployment/ethereum-node -c geth
kubectl logs -f -n rpcaas deployment/ethereum-node -c lighthouse

# Check sync status
kubectl exec -n rpcaas deployment/ethereum-node -c geth -- \
  geth attach --exec 'eth.syncing' http://localhost:8545
```

Ethereum sync takes 7-14 days on HDD. During this time, L2 nodes can use a temporary external RPC.

## Step 4: Deploy L2 Nodes

Deploy in order of disk size (smallest first) to get some chains online while others sync.

```bash
# Optimism (~100GB, 2-3 days)
cd nodes/optimism
helm install optimism-node . --namespace rpcaas

# Base (~150GB, 2-3 days)
cd nodes/base
helm install base-node . --namespace rpcaas

# Arbitrum (~200GB, 3-5 days)
cd nodes/arbitrum
helm install arbitrum-node . --namespace rpcaas

# Polygon (~250GB, 5-7 days)
cd nodes/polygon
helm install polygon-node . --namespace rpcaas
```

### Using Temporary L1 RPC During Ethereum Sync

If you need L2 nodes running before Ethereum is fully synced:

```bash
# Override L1 RPC URL with a temporary external endpoint
helm install base-node nodes/base/ --namespace rpcaas \
  --set l1RpcUrl=https://eth-mainnet.g.alchemy.com/v2/YOUR_FREE_KEY

# After Ethereum syncs, upgrade to use internal endpoint
helm upgrade base-node nodes/base/ --namespace rpcaas \
  --set l1RpcUrl=http://ethereum-node.rpcaas.svc.cluster.local:8545
```

## Step 5: Build and Deploy Proxy

```bash
# Build Docker image
cd proxy
docker build -t opsalis/rpcaas-proxy:latest .
docker push opsalis/rpcaas-proxy:latest

# Deploy to k3s
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Verify
kubectl get pods -n rpcaas
kubectl logs -f -n rpcaas deployment/rpcaas-proxy
```

## Step 6: Configure Cloudflare Tunnel

```bash
# Add rpcaas route to existing Cloudflare Tunnel config
# In the tunnel's config.yaml, add:
#
# - hostname: rpc.opsalis.com
#   service: http://rpcaas-proxy.rpcaas.svc.cluster.local:3100
#
# Then restart cloudflared

# Or via Cloudflare dashboard:
# Tunnel → Public Hostname → Add
# Subdomain: rpc
# Domain: opsalis.com
# Service: HTTP://rpcaas-proxy.rpcaas.svc.cluster.local:3100
```

## Step 7: Verify End-to-End

```bash
# Test health endpoint
curl https://rpc.opsalis.com/health

# Test RPC (use a demo key from proxy logs)
curl https://rpc.opsalis.com/v1/base/rpk_DEMO_KEY \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## Step 8: Deploy Website

```bash
cd website

# Option A: Cloudflare Pages via CLI
npx wrangler pages deploy . --project-name=rpcaas

# Option B: Git-based deploy
# Push to GitHub → Cloudflare Pages auto-deploys from repo
```

## Monitoring

### Check Node Sync Status

```bash
# All nodes at once
for chain in base optimism arbitrum polygon ethereum; do
  echo "=== $chain ==="
  kubectl exec -n rpcaas deployment/${chain}-node -c $(kubectl get pod -n rpcaas -l app=${chain}-node -o jsonpath='{.items[0].spec.containers[0].name}') -- \
    wget -qO- http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' --header='Content-Type: application/json' 2>/dev/null || echo "Not ready"
done
```

### Check Disk Usage

```bash
ssh node-uk1 'df -h /mnt/chains && du -sh /mnt/chains/*'
```

### Proxy Metrics

```bash
kubectl logs -n rpcaas deployment/rpcaas-proxy --tail=100
```

## Upgrading

### Proxy Upgrade

```bash
cd proxy
docker build -t opsalis/rpcaas-proxy:v1.1.0 .
docker push opsalis/rpcaas-proxy:v1.1.0

kubectl set image -n rpcaas deployment/rpcaas-proxy \
  proxy=opsalis/rpcaas-proxy:v1.1.0
```

### Node Upgrade

```bash
# Upgrade one chain at a time to avoid simultaneous downtime
helm upgrade base-node nodes/base/ --namespace rpcaas \
  --set opGeth.image.tag=v1.101411.1

# Wait for pod to restart and verify sync
kubectl rollout status -n rpcaas deployment/base-node
```

## Backup

Chain data does not need backup — it can always be re-synced from the network. The only critical data is:

- **API keys database** (when moved from in-memory to persistent storage)
- **JWT secrets** (in /data/jwt.hex on each node — but these are auto-generated)

## Troubleshooting

### Node stuck syncing
```bash
# Check logs for the stuck node
kubectl logs -n rpcaas deployment/base-node -c op-geth --tail=200

# Common fix: restart the pod
kubectl rollout restart -n rpcaas deployment/base-node
```

### Disk full
```bash
# Check which chain is using the most space
ssh node-uk1 'du -sh /mnt/chains/*'

# Emergency: stop the largest non-essential chain
kubectl scale -n rpcaas deployment/polygon-node --replicas=0
```

### Proxy returning 502
```bash
# Check if the target node is running
kubectl get pods -n rpcaas -l chain=base

# Check if the service resolves
kubectl exec -n rpcaas deployment/rpcaas-proxy -- \
  wget -qO- http://base-node.rpcaas.svc.cluster.local:8545 \
  --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  --header='Content-Type: application/json'
```
