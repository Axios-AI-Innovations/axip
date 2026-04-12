/**
 * AXIP SDK — TypeScript Type Definitions
 *
 * Complete types for the AXIP Agent Interchange Protocol SDK.
 * Based on PROTOCOL-v1.md and actual API surface of the SDK source files.
 */

/// <reference types="node" />

import { EventEmitter } from 'events';

// ─── Protocol Version ──────────────────────────────────────────

export type AXIPVersion = '0.1.0' | '1.0.0';

// ─── Identity ──────────────────────────────────────────────────

/**
 * A loaded AXIP agent identity with keypair and derived IDs.
 */
export interface AXIPIdentity {
  agentId: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  pubkeyFormatted: string; // "ed25519:<base64>"
}

/**
 * The persistent identity file stored at ~/.axip/<name>/identity.json
 */
export interface IdentityFile {
  agentId: string;
  publicKey: string;   // base64-encoded
  secretKey: string;   // base64-encoded
  createdAt: string;   // ISO 8601 timestamp
}

// ─── Message Envelope ──────────────────────────────────────────

export type MessageTarget = string | 'network' | 'relay';

export interface MessageSender {
  agent_id: string;
  pubkey: string; // "ed25519:<base64>"
}

/**
 * AXIP protocol message envelope — the top-level structure for all messages.
 */
export interface AXIPMessage<T extends MessagePayload = MessagePayload> {
  axip: string;
  id: string;         // "msg_<uuid>"
  type: MessageType;
  from: MessageSender;
  to: MessageTarget;
  timestamp: string;  // ISO 8601
  nonce: string;      // UUID for replay protection
  payload: T;
  signature: string | null; // "ed25519:<base64>" (null before signing)
}

// ─── Message Types ─────────────────────────────────────────────

export type MessageType =
  | 'announce'
  | 'announce_ack'
  | 'discover'
  | 'discover_result'
  | 'task_request'
  | 'task_bid'
  | 'task_accept'
  | 'task_result'
  | 'task_verify'
  | 'task_settle'
  | 'task_cancel'
  | 'heartbeat'
  | 'capability_update'
  | 'balance_request'
  | 'balance_result'
  | 'status_request'
  | 'status_result'
  | 'error';

export type TaskStatus = 'completed' | 'failed' | 'in_progress';

export type ErrorCode =
  | 'INVALID_SIGNATURE'
  | 'REPLAY_DETECTED'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_BALANCE'
  | 'TASK_NOT_FOUND'
  | 'BID_NOT_FOUND'
  | 'INVALID_STATE'
  | 'AGENT_OFFLINE'
  | 'MESSAGE_TOO_LARGE'
  | 'INVALID_CAPABILITY';

// ─── Payload Interfaces ────────────────────────────────────────

export type MessagePayload =
  | AnnouncePayload
  | AnnounceAckPayload
  | DiscoverPayload
  | DiscoverResultPayload
  | TaskRequestPayload
  | TaskBidPayload
  | TaskAcceptPayload
  | TaskResultPayload
  | TaskVerifyPayload
  | TaskSettlePayload
  | HeartbeatPayload
  | ErrorPayload
  | Record<string, unknown>;

export interface PricingEntry {
  base_usd: number;
}

export interface AgentConstraints {
  max_cost_usd?: number;
  min_reputation?: number;
  [key: string]: unknown;
}

export interface AgentMetadata {
  operator?: string;
  framework?: string;
  version?: string;
  [key: string]: unknown;
}

export interface AnnouncePayload {
  name: string;
  capabilities: string[];
  pricing: Record<string, PricingEntry>;
  constraints: AgentConstraints;
  metadata: AgentMetadata;
  version: string;
}

export interface AnnounceAckPayload {
  agent_id: string;
  balance_usd?: number;
  reputation?: number;
  registered: boolean;
  request_id?: string;
  [key: string]: unknown;
}

export interface DiscoverPayload {
  capability: string;
  constraints: AgentConstraints;
}

export interface AgentSummary {
  agent_id: string;
  name: string;
  capabilities: string[];
  pricing: Record<string, PricingEntry>;
  reputation: number;
  [key: string]: unknown;
}

export interface DiscoverResultPayload {
  agents: AgentSummary[];
  request_id: string;
}

export interface TaskRequestPayload {
  task_id: string;
  description: string;
  capability_required: string;
  constraints: AgentConstraints;
  reward: number;
}

export interface TaskBidPayload {
  task_id: string;
  bid_id: string;
  price_usd: number;
  estimated_time_seconds: number;
  confidence: number;
  model: string;
  message: string;
}

export interface TaskAcceptPayload {
  task_id: string;
  bid_id: string;
}

export interface TaskResultPayload {
  task_id: string;
  status: TaskStatus;
  output: unknown;
  actual_cost_usd: number;
  actual_time_seconds: number;
  model_used: string;
}

export interface TaskVerifyPayload {
  task_id: string;
  verified: boolean;
  quality_score: number;
  feedback: string;
}

export interface TaskSettlePayload {
  task_id: string;
  amount_usd: number;
  settlement_method: string;
  from_balance?: number;
  to_balance?: number;
  platform_fee_usd?: number;
  from_agent?: string;
  to_agent?: string;
  new_reputation?: number;
}

export interface HeartbeatPayload {
  status: string;
  active_tasks: number;
  load: number;
}

export interface ErrorPayload {
  code: ErrorCode | string;
  message: string;
  related_message_id?: string;
  ref_id?: string;
}

// ─── Validation ────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

// ─── AXIPConnection ────────────────────────────────────────────

export interface AXIPConnectionOptions {
  url: string;
  reconnect?: boolean;
  heartbeatInterval?: number;
  maxReconnectDelay?: number;
}

/**
 * Low-level WebSocket connection manager with auto-reconnect and heartbeat.
 * Emits: 'connected', 'disconnected', 'message', 'heartbeat-needed'
 */
export declare class AXIPConnection extends EventEmitter {
  url: string;
  shouldReconnect: boolean;
  heartbeatInterval: number;
  maxReconnectDelay: number;
  connected: boolean;

  constructor(opts: AXIPConnectionOptions);

  /** Open the WebSocket connection. Resolves when connected. */
  connect(): Promise<void>;

  /** Send a JSON message. Throws if not connected. */
  send(msg: AXIPMessage): void;

  /** Gracefully disconnect and disable auto-reconnect. */
  disconnect(): void;

  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'message', listener: (msg: AXIPMessage) => void): this;
  on(event: 'heartbeat-needed', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

// ─── AXIPAgent Options ─────────────────────────────────────────

export interface AXIPAgentOptions {
  /** Agent name, also used as the identity directory under ~/.axip/ */
  name: string;
  /** Capabilities this agent provides (e.g. ['web_search', 'summarize']) */
  capabilities?: string[];
  /** Relay WebSocket URL. Defaults to AXIP_RELAY_URL env var or 'ws://127.0.0.1:4200' */
  relayUrl?: string;
  /** Per-capability pricing map */
  pricing?: Record<string, PricingEntry>;
  /** Agent metadata (operator, framework, version, etc.) */
  metadata?: AgentMetadata;
}

export interface SendBidOptions {
  price: number;
  etaSeconds?: number;
  confidence?: number;
  model?: string;
  message?: string;
}

export interface SendResultOptions {
  status?: TaskStatus;
  actualCost?: number;
  actualTime?: number;
  modelUsed?: string;
}

// ─── AXIPAgent ─────────────────────────────────────────────────

/**
 * Main interface for building AXIP-compatible agents.
 * Manages crypto identity, message building, WebSocket connection, and event routing.
 *
 * @example
 * const agent = new AXIPAgent({ name: 'my-agent', capabilities: ['web_search'] });
 * agent.on('task_request', async (msg) => { ... });
 * await agent.start();
 */
export declare class AXIPAgent extends EventEmitter {
  name: string;
  capabilities: string[];
  pricing: Record<string, PricingEntry>;
  metadata: AgentMetadata;
  relayUrl: string;
  identity: AXIPIdentity;
  connection: AXIPConnection;

  constructor(opts: AXIPAgentOptions);

  // ─── Lifecycle ───────────────────────────────────────────────

  /**
   * Connect to the relay and announce capabilities.
   * Resolves when the WebSocket connection is open and announce is sent.
   */
  start(): Promise<void>;

  /**
   * Disconnect from the relay and clear all pending requests.
   */
  stop(): void;

  // ─── Sending Messages ────────────────────────────────────────

  /**
   * Send a raw typed message. Signs before sending.
   * @returns The sent message (for correlation)
   */
  send(type: MessageType | string, to: MessageTarget, payload: Record<string, unknown>): AXIPMessage;

  /**
   * Discover agents with a specific capability.
   * Returns a promise resolving to the discover_result message.
   */
  discover(capability: string, constraints?: AgentConstraints): Promise<AXIPMessage<DiscoverResultPayload>>;

  /**
   * Send a task bid to the requester.
   */
  sendBid(to: MessageTarget, taskId: string, opts: SendBidOptions): AXIPMessage<TaskBidPayload>;

  /**
   * Accept a bid on a task (as the requester).
   */
  acceptBid(to: MessageTarget, taskId: string, bidId: string): AXIPMessage<TaskAcceptPayload>;

  /**
   * Send task result (as the assignee).
   */
  sendResult(
    to: MessageTarget,
    taskId: string,
    output: unknown,
    opts?: SendResultOptions
  ): AXIPMessage<TaskResultPayload>;

  /**
   * Verify a task result and trigger settlement (as the requester).
   */
  verifyResult(
    to: MessageTarget,
    taskId: string,
    verified: boolean,
    qualityScore: number,
    feedback?: string
  ): AXIPMessage<TaskVerifyPayload>;

  // ─── Events ──────────────────────────────────────────────────

  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'announce_ack', listener: (msg: AXIPMessage<AnnounceAckPayload>) => void): this;
  on(event: 'discover_result', listener: (msg: AXIPMessage<DiscoverResultPayload>) => void): this;
  on(event: 'task_request', listener: (msg: AXIPMessage<TaskRequestPayload>) => void): this;
  on(event: 'task_bid', listener: (msg: AXIPMessage<TaskBidPayload>) => void): this;
  on(event: 'task_accept', listener: (msg: AXIPMessage<TaskAcceptPayload>) => void): this;
  on(event: 'task_result', listener: (msg: AXIPMessage<TaskResultPayload>) => void): this;
  on(event: 'task_verify', listener: (msg: AXIPMessage<TaskVerifyPayload>) => void): this;
  on(event: 'task_settle', listener: (msg: AXIPMessage<TaskSettlePayload>) => void): this;
  on(event: 'task_cancel', listener: (msg: AXIPMessage<{ task_id: string; reason: string }>) => void): this;
  on(event: 'error_message', listener: (msg: AXIPMessage<ErrorPayload>) => void): this;
  on(event: 'unknown_message', listener: (msg: AXIPMessage) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

// ─── messages module ───────────────────────────────────────────

export declare namespace messages {
  /** Produce deterministic JSON string for signing (fields sorted, signature excluded). */
  function canonicalize(msg: AXIPMessage): string;

  /** Sign a message in place — mutates msg.signature. */
  function signMessage(msg: AXIPMessage, secretKey: Uint8Array): void;

  /** Verify a message's signature against its embedded public key. */
  function verifyMessage(msg: AXIPMessage): boolean;

  /** Build an unsigned AXIP message envelope. */
  function buildMessage(
    type: MessageType | string,
    from: Pick<AXIPIdentity, 'agentId' | 'pubkeyFormatted'>,
    to: MessageTarget,
    payload: Record<string, unknown>
  ): AXIPMessage;

  function buildAnnounce(
    from: AXIPIdentity,
    opts: { capabilities: string[]; name: string; pricing?: Record<string, PricingEntry>; constraints?: AgentConstraints; metadata?: AgentMetadata }
  ): AXIPMessage<AnnouncePayload>;

  function buildDiscover(
    from: AXIPIdentity,
    opts: { capability: string; constraints?: AgentConstraints }
  ): AXIPMessage<DiscoverPayload>;

  function buildDiscoverResult(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { agents: AgentSummary[]; requestId: string }
  ): AXIPMessage<DiscoverResultPayload>;

  function buildTaskRequest(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { taskId?: string; description: string; capability: string; constraints?: AgentConstraints; reward?: number }
  ): AXIPMessage<TaskRequestPayload>;

  function buildTaskBid(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { taskId: string; bidId?: string; price: number; etaSeconds?: number; confidence?: number; model?: string; message?: string }
  ): AXIPMessage<TaskBidPayload>;

  function buildTaskAccept(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { taskId: string; bidId: string }
  ): AXIPMessage<TaskAcceptPayload>;

  function buildTaskResult(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { taskId: string; status?: TaskStatus; output: unknown; actualCost?: number; actualTime?: number; modelUsed?: string }
  ): AXIPMessage<TaskResultPayload>;

  function buildTaskVerify(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { taskId: string; verified: boolean; qualityScore: number; feedback?: string }
  ): AXIPMessage<TaskVerifyPayload>;

  function buildTaskSettle(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { taskId: string; amount: number; fromBalance?: number; toBalance?: number }
  ): AXIPMessage<TaskSettlePayload>;

  function buildHeartbeat(
    from: AXIPIdentity,
    opts?: { status?: string; activeTasks?: number; load?: number }
  ): AXIPMessage<HeartbeatPayload>;

  function buildError(
    from: AXIPIdentity,
    to: MessageTarget,
    opts: { code: ErrorCode | string; message: string; relatedMessageId?: string }
  ): AXIPMessage<ErrorPayload>;

  /** Validate an AXIP message envelope has all required fields. */
  function validateMessage(msg: unknown): ValidationResult;
}

// ─── crypto module ─────────────────────────────────────────────

export declare namespace crypto {
  /** Encode a Uint8Array to a base64 string. */
  function toBase64(bytes: Uint8Array): string;

  /** Decode a base64 string to a Uint8Array. */
  function fromBase64(b64: string): Uint8Array;

  /** Generate a new Ed25519 keypair. */
  function generateKeypair(): { publicKey: Uint8Array; secretKey: Uint8Array };

  /** Format a public key as "ed25519:<base64>". */
  function formatPubkey(publicKey: Uint8Array): string;

  /** Parse a formatted pubkey string to raw bytes. Throws on invalid format. */
  function parsePubkey(formatted: string): Uint8Array;

  /**
   * Sign a message string with an Ed25519 secret key.
   * @returns "ed25519:<base64 signature>"
   */
  function sign(message: string, secretKey: Uint8Array): string;

  /**
   * Verify a detached Ed25519 signature.
   * @param signature - "ed25519:<base64 signature>"
   */
  function verify(message: string, signature: string, publicKey: Uint8Array): boolean;

  /**
   * Load an existing identity from ~/.axip/<name>/identity.json,
   * or generate and persist a new one if it doesn't exist.
   */
  function loadOrCreateIdentity(name?: string): AXIPIdentity;
}
