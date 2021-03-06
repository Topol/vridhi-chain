const bodyParser = require('body-parser');
const express = require('express');
const request = require('request');
const path = require('path');
const Blockchain = require('./blockchain');
const Block = require('./blockchain/block');
const PubSub = require('./app/pubsub');
const TransactionPool = require('./wallet/transaction-pool');
const Wallet = require('./wallet');
const TransactionMiner = require('./app/transaction-miner');
const Transaction = require('./wallet/transaction');

const isDevelopment = process.env.ENV === 'development';

const REDIS_URL = isDevelopment ?
  'redis://127.0.0.1:6379' :
    'redis://:p4fa55686b1aa6fd3fead26823d8a2e390e7ca30d51b910e85d27fe19d873636e@ec2-54-205-101-169.compute-1.amazonaws.com:26339'
const DEFAULT_PORT = 4000;
const ROOT_NODE_ADDRESS = `http://localhost:${DEFAULT_PORT}`;

const app = express();
const blockchain = new Blockchain();
const transactionPool = new TransactionPool();
const wallet = new Wallet();
const pubsub = new PubSub({ blockchain, transactionPool, redisUrl: REDIS_URL });
// const pubsub = new PubSub({ blockchain, transactionPool, wallet }); // for PubNub
const transactionMiner = new TransactionMiner({ blockchain, transactionPool, wallet, pubsub });

const cors = require('cors');
app.use(cors());
const { createProxyMiddleware } = require('http-proxy-middleware');
/*app.use('/api', createProxyMiddleware({
  target: 'http://localhost:8080/', //original url
  changeOrigin: true,
  //secure: false,
  onProxyRes: function (proxyRes, req, res) {
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  }
}));*/

app.all('/', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'client/dist')));

app.get('/api/blocks', (req, res) => {
  res.json(blockchain.chain);
});

app.get('/api/blocks/length', (req, res) => {
  res.json(blockchain.chain.length);
});

app.get('/api/blocks/:id', (req, res) => {
  const { id } = req.params;
  const { length } = blockchain.chain;

  const blocksReversed = blockchain.chain.slice().reverse();

  let startIndex = (id-1) * 5;
  let endIndex = id * 5;

  startIndex = startIndex < length ? startIndex : length;
  endIndex = endIndex < length ? endIndex : length;

  res.json(blocksReversed.slice(startIndex, endIndex));
});

app.post('/api/mine', (req, res) => {
  const { data } = req.body;

  blockchain.addBlock({ data });

  pubsub.broadcastChain();

  res.redirect('/api/blocks');
});

app.post('/api/transact', (req, res) => {
  const { amount, recipient } = req.body;

  let transaction = transactionPool
      .existingTransaction({ inputAddress: wallet.publicKey });

  try {
    if (transaction) {
      transaction.update({ senderWallet: wallet, recipient, amount });
    } else {
      transaction = wallet.createTransaction({
        recipient,
        amount,
        chain: blockchain.chain
      });
    }
  } catch(error) {
    return res.status(400).json({ type: 'error', message: error.message });
  }

  transactionPool.setTransaction(transaction);

  pubsub.broadcastTransaction(transaction);

  res.json({ type: 'success', transaction });


});

app.post('/api/odktransact', (req, res) => {
  const { publickey } = req.body;
  const newData = JSON.stringify(req.body);
  const amount = 50;
  const recipient = publickey;

  let transaction = transactionPool
      .existingTransaction({ inputAddress: wallet.publicKey });

  try {
    if (transaction) {
      transaction.update({ senderWallet: wallet, recipient, amount });
    } else {
      transaction = wallet.createTransaction({
        recipient,
        amount,
        chain: blockchain.chain
      });
    }
  } catch(error) {
    return res.status(400).json({ type: 'error', message: error.message });
  }

  transactionPool.setTransaction(transaction);

  pubsub.broadcastTransactionODK(transaction,newData);

  res.json({ type: 'success', transaction });

  console.log(JSON.stringify(transaction).concat(newData));
  transactionMiner.mineTransactions();

 // res.redirect('/');


});

app.post('/api/transfercurrency', (req, res) => {
  const { sender, recipient, amount } = req.body;

  let balance1 =  Wallet.calculateBalance({ chain: blockchain.chain, sender });
  let balance2 =  Wallet.calculateBalance({ chain: blockchain.chain, recipient });

  console.log(balance1);
  console.log(balance2);

  balance1 = balance1 - amount;
  balance2 = balance2 + amount;

  console.log(balance1);
  console.log(balance2);

  /*
  try {
    transaction.createOutputMap({sender, recipient, amount});
    transaction.update({ senderWallet: wallet, recipient, amount });
  } catch(error) {
    return res.status(400).json({ type: 'error', message: error.message });
  }
*/

 // return new Transaction({ sender, recipient, amount });



  /*

  if (amount > this.wbalance) {
    throw new Error('Amount exceeds balance');
  }




  let transaction = transactionPool
      .existingTransaction({ inputAddress: sender });

  try {
    if (transaction) {
      transaction.update({ senderWallet: wallet, recipient, amount });

    } else {
      console.log("here");
      transaction = wallet.createTransactionBetweenWallets({
        sender,
        recipient,
        amount,
        chain: blockchain.chain
      });
    }
  } catch(error) {
    return res.status(400).json({ type: 'error', message: error.message });
  }

  transactionPool.setTransaction(transaction);

  pubsub.broadcastTransaction(transaction);

  res.json({ type: 'success', transaction });

  transactionMiner.mineTransactions();

  // res.redirect('/');
*/

});

app.get('/api/transaction-pool-map', (req, res) => {
  res.json(transactionPool.transactionMap);
});

app.get('/api/mine-transactions', (req, res) => {
  transactionMiner.mineTransactions();

  res.redirect('/api/blocks');
});

app.get('/api/wallet-info', (req, res) => {
  const address = wallet.publicKey;

  res.json({
    address,
    balance: Wallet.calculateBalance({ chain: blockchain.chain, address })
  });
});

app.post('/api/wallet-data', (req, res) => {
  console.log(req.body);
  const { address } = req.body;
  //console.log(req.body);
  //const address = "04bbebf70265d1e62fc8e4201c25a123bd8aaafef4e411ef04854d1e95c6245d4c0bb1694aec895f3c37157b66ae1cd7eba29a6d07524ab3f440099fc2c276b8df";

  res.json({
    address,
    balance: Wallet.calculateBalance({ chain: blockchain.chain, address })
  });

});

app.get('/api/known-addresses', (req, res) => {
  const addressMap = {};

  for (let block of blockchain.chain) {
    for (let transaction of block.data) {
      const recipient = Object.keys(transaction.outputMap);

      recipient.forEach(recipient => addressMap[recipient] = recipient);
    }
  }

  res.json(Object.keys(addressMap));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

const syncWithRootState = () => {
  request({ url: `${ROOT_NODE_ADDRESS}/api/blocks` }, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      const rootChain = JSON.parse(body);

      console.log('replace chain on a sync with', rootChain);
      blockchain.replaceChain(rootChain);
    }
  });

  request({ url: `${ROOT_NODE_ADDRESS}/api/transaction-pool-map` }, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      const rootTransactionPoolMap = JSON.parse(body);

      console.log('replace transaction pool map on a sync with', rootTransactionPoolMap);
      transactionPool.setMap(rootTransactionPoolMap);
    }
  });
};

if (isDevelopment) {
  const walletFoo = new Wallet();
  const walletBar = new Wallet();

  const generateWalletTransaction = ({ wallet, recipient, amount }) => {
    const transaction = wallet.createTransaction({
      recipient, amount, chain: blockchain.chain
    });

    transactionPool.setTransaction(transaction);
  };

  const walletAction = () => generateWalletTransaction({
    wallet, recipient: walletFoo.publicKey, amount: 5
  });

  const walletFooAction = () => generateWalletTransaction({
    wallet: walletFoo, recipient: walletBar.publicKey, amount: 10
  });

  const walletBarAction = () => generateWalletTransaction({
    wallet: walletBar, recipient: wallet.publicKey, amount: 15
  });

  for (let i=0; i<20; i++) {
    if (i%3 === 0) {
      walletAction();
      walletFooAction();
    } else if (i%3 === 1) {
      walletAction();
      walletBarAction();
    } else {
      walletFooAction();
      walletBarAction();
    }

    transactionMiner.mineTransactions();
  }
}

let PEER_PORT;

if (process.env.GENERATE_PEER_PORT === 'true') {
  PEER_PORT = DEFAULT_PORT + Math.ceil(Math.random() * 1000);
}

const PORT = process.env.PORT || PEER_PORT || DEFAULT_PORT;
app.listen(PORT, () => {
  console.log(`listening at localhost:${PORT}`);

  if (PORT !== DEFAULT_PORT) {
    syncWithRootState();
  }
});

module.exports = wallet.publicKey;