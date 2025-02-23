const express = require('express');
const k8s = require('@kubernetes/client-node');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// 初始化 Kubernetes 客戶端
const kc = new k8s.KubeConfig();
if (process.env.NODE_ENV === 'production') {
  kc.loadFromCluster(); // 叢集內認證
} else {
  kc.loadFromDefault(); // 本地 kubeconfig
}
const k8sClient = k8s.makeApiClient(kc);

app.get('/k8s-status', async (req, res) => {
  try {
    const nodes = await k8sClient.api.v1.nodes.get();
    const pods = await k8sClient.api.v1.namespaces('default').pods.get();

    const status = {
      nodes: nodes.body.items.map(node => ({
        name: node.metadata.name,
        status: node.status.conditions.find(c => c.type === 'Ready').status
      })),
      pods: pods.body.items.map(pod => ({
        name: pod.metadata.name,
        status: pod.status.phase
      }))
    };

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: '無法取得 Kubernetes 狀態', details: error.message });
  }
});

app.post('/dns-test', async (req, res) => {
  const { serviceName, customPort } = req.body;
  if (!serviceName) {
    return res.status(400).json({ error: '請提供 k8s 服務名稱' });
  }

  const fullServiceName = serviceName.includes('.svc.') 
    ? serviceName 
    : `${serviceName}.default.svc.cluster.local`;

  try {
    const addresses = await dns.resolve(fullServiceName);
    if (!addresses || addresses.length === 0) {
      throw new Error('無法解析到任何地址');
    }

    const testConnection = (address, port) => {
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, address);
      });
    };

    const results = {};
    results['80'] = await testConnection(addresses[0], 80);
    results['443'] = await testConnection(addresses[0], 443);

    if (customPort) {
      const portNum = parseInt(customPort, 10);
      if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
        results[customPort] = await testConnection(addresses[0], portNum);
      }
    }

    res.json({
      success: true,
      resolvedAddresses: addresses,
      connectionResults: results
    });
  } catch (error) {
    res.json({
      success: false,
      error: 'DNS 解析或連線失敗',
      details: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`伺服器運行在 http://localhost:${port}`);
});