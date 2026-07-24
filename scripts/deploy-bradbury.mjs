import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import { formatEther, getAddress } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const CONTRACT_PATH = path.join(ROOT, "contract", "grantos.py");
const DEPLOYMENT_PATH = path.join(ROOT, "deployments", "bradbury.json");
const REQUIRED_METHODS = [
  "create_grant",
  "get_grant",
  "get_grant_progress",
  "get_milestone_result",
  "resolve_pending_review",
  "submit_milestone",
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${path.relative(ROOT, filePath)}.`);
  }

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) return [line, ""];
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

function normalizePrivateKey(value) {
  const key = value?.startsWith("0x") ? value : `0x${value ?? ""}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("PRIVATE_KEY must contain a 32-byte hexadecimal private key.");
  }
  return key;
}

function schemaMethodNames(schema) {
  if (Array.isArray(schema?.methods)) {
    return schema.methods.map((method) => method.name);
  }
  return Object.keys(schema?.methods ?? {});
}

function upsertEnvValue(filePath, key, value) {
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));

  if (index >= 0) {
    lines[index] = `${prefix}${value}`;
  } else {
    if (lines.at(-1) !== "") lines.push("");
    lines.push(`${prefix}${value}`);
  }

  fs.writeFileSync(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

async function deploymentFailure(client, hash, receipt) {
  let trace;
  try {
    trace = await client.debugTraceTransaction({ hash });
  } catch (error) {
    trace = { trace_error: error.message };
  }

  const details = {
    txExecutionResultName: receipt?.txExecutionResultName,
    resultName: receipt?.resultName,
    statusName: receipt?.statusName,
    stderr: trace?.stderr,
    stdout: trace?.stdout,
    resultCode: trace?.result_code,
    traceError: trace?.trace_error,
  };
  throw new Error(`Deployment execution failed:\n${JSON.stringify(details, null, 2)}`);
}

async function main() {
  const preflightOnly = process.argv.includes("--preflight");
  const env = readEnvFile(ENV_PATH);
  const account = createAccount(normalizePrivateKey(env.PRIVATE_KEY));
  const declaredAddress = getAddress(env.WALLET_ADDRESS);

  if (account.address.toLowerCase() !== declaredAddress.toLowerCase()) {
    throw new Error("WALLET_ADDRESS does not match PRIVATE_KEY.");
  }

  const client = createClient({ chain: testnetBradbury, account });
  const contractCode = fs.readFileSync(CONTRACT_PATH, "utf8");

  console.log("Running Bradbury schema preflight...");
  const preflightSchema = await client.getContractSchemaForCode(contractCode);
  const methods = schemaMethodNames(preflightSchema);
  const missingMethods = REQUIRED_METHODS.filter((method) => !methods.includes(method));
  if (missingMethods.length) {
    throw new Error(`Schema is missing expected methods: ${missingMethods.join(", ")}`);
  }

  const balance = await client.getBalance({ address: account.address });
  console.log(`Deployer balance: ${formatEther(balance)} GEN`);
  if (balance === 0n) {
    throw new Error("The Bradbury deployer wallet has no GEN.");
  }
  if (preflightOnly) {
    console.log("Bradbury preflight passed. No transaction was submitted.");
    return;
  }

  console.log("Submitting GrantOS deployment to Bradbury...");
  const txHash = await client.deployContract({
    code: contractCode,
    args: [],
  });
  console.log(`Deployment transaction: ${txHash}`);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 5_000,
    retries: 240,
  });

  if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    await deploymentFailure(client, txHash, receipt);
  }

  const transaction = receipt.txDataDecoded ? receipt : await client.getTransaction({ hash: txHash });
  const contractAddress =
    transaction.txDataDecoded?.contractAddress ??
    transaction.recipient ??
    transaction.to_address;

  if (!contractAddress) {
    throw new Error("Deployment finalized but the SDK did not return a contract address.");
  }

  const [deployedCode, deployedSchema] = await Promise.all([
    client.getContractCode(contractAddress),
    client.getContractSchema(contractAddress),
  ]);
  if (deployedCode.trim() !== contractCode.trim()) {
    throw new Error("The deployed source code does not match contract/grantos.py.");
  }

  const deployedMethods = schemaMethodNames(deployedSchema);
  const missingDeployedMethods = REQUIRED_METHODS.filter((method) => !deployedMethods.includes(method));
  if (missingDeployedMethods.length) {
    throw new Error(`Deployed schema is missing methods: ${missingDeployedMethods.join(", ")}`);
  }

  const deployment = {
    network: "testnet-bradbury",
    contract: "GrantOS",
    address: contractAddress,
    transactionHash: txHash,
    deployedAt: new Date().toISOString(),
    runner: "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6",
    methods: deployedMethods.sort(),
  };

  fs.mkdirSync(path.dirname(DEPLOYMENT_PATH), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
  upsertEnvValue(ENV_PATH, "VITE_CONTRACT_ADDRESS", contractAddress);

  console.log(`GrantOS deployed and verified at ${contractAddress}`);
  console.log(`Deployment record: ${path.relative(ROOT, DEPLOYMENT_PATH)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
