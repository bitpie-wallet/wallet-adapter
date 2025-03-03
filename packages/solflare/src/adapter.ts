import {
    EventEmitter,
    pollUntilReady,
    WalletAccountError,
    WalletAdapter,
    WalletAdapterEvents,
    WalletConnectionError,
    WalletDisconnectedError,
    WalletDisconnectionError,
    WalletError,
    WalletNotConnectedError,
    WalletNotFoundError,
    WalletNotInstalledError,
    WalletPublicKeyError,
    WalletSignatureError,
} from '@solana/wallet-adapter-base';
import { PublicKey, Transaction } from '@solana/web3.js';

interface SolflareWalletEvents {
    connect: (...args: unknown[]) => unknown;
    disconnect: (...args: unknown[]) => unknown;
}

interface SolflareWallet extends EventEmitter<SolflareWalletEvents> {
    isSolflare?: boolean;
    publicKey?: { toBuffer(): Buffer };
    isConnected: boolean;
    autoApprove: boolean;
    signTransaction: (transaction: Transaction) => Promise<Transaction>;
    signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
    connect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
}

interface SolflareWindow extends Window {
    solflare?: SolflareWallet;
}

declare const window: SolflareWindow;

export interface SolflareWalletAdapterConfig {
    pollInterval?: number;
    pollCount?: number;
}

export class SolflareWalletAdapter extends EventEmitter<WalletAdapterEvents> implements WalletAdapter {
    private _connecting: boolean;
    private _wallet: SolflareWallet | null;
    private _publicKey: PublicKey | null;

    constructor(config: SolflareWalletAdapterConfig = {}) {
        super();
        this._connecting = false;
        this._wallet = null;
        this._publicKey = null;

        if (!this.ready) pollUntilReady(this, config.pollInterval || 1000, config.pollCount || 3);
    }

    get publicKey(): PublicKey | null {
        return this._publicKey;
    }

    get ready(): boolean {
        return !!window.solflare?.isSolflare;
    }

    get connecting(): boolean {
        return this._connecting;
    }

    get connected(): boolean {
        return !!this._wallet?.isConnected;
    }

    get autoApprove(): boolean {
        return !!this._wallet?.autoApprove;
    }

    async connect(): Promise<void> {
        try {
            if (this.connected || this.connecting) return;
            this._connecting = true;

            const wallet = window.solflare;
            if (!wallet) throw new WalletNotFoundError();
            if (!wallet.isSolflare) throw new WalletNotInstalledError();

            if (!wallet.isConnected) {
                try {
                    await wallet.connect();
                } catch (error) {
                    if (error instanceof WalletError) throw error;
                    throw new WalletConnectionError(error?.message, error);
                }
            }

            let buffer: Buffer;
            try {
                buffer = wallet.publicKey!.toBuffer();
            } catch (error) {
                throw new WalletAccountError(error?.message, error);
            }

            let publicKey: PublicKey;
            try {
                publicKey = new PublicKey(buffer);
            } catch (error) {
                throw new WalletPublicKeyError(error?.message, error);
            }

            wallet.on('disconnect', this._disconnected);

            this._wallet = wallet;
            this._publicKey = publicKey;

            this.emit('connect');
        } catch (error) {
            this.emit('error', error);
            throw error;
        } finally {
            this._connecting = false;
        }
    }

    async disconnect(): Promise<void> {
        const wallet = this._wallet;
        if (wallet) {
            wallet.off('disconnect', this._disconnected);

            this._wallet = null;
            this._publicKey = null;

            try {
                await wallet.disconnect();
            } catch (error) {
                this.emit('error', new WalletDisconnectionError(error.message, error));
            }

            this.emit('disconnect');
        }
    }

    async signTransaction(transaction: Transaction): Promise<Transaction> {
        try {
            const wallet = this._wallet;
            if (!wallet) throw new WalletNotConnectedError();

            try {
                return wallet.signTransaction(transaction);
            } catch (error) {
                throw new WalletSignatureError(error?.message, error);
            }
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async signAllTransactions(transactions: Transaction[]): Promise<Transaction[]> {
        try {
            const wallet = this._wallet;
            if (!wallet) throw new WalletNotConnectedError();

            try {
                return wallet.signAllTransactions(transactions);
            } catch (error) {
                throw new WalletSignatureError(error?.message, error);
            }
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    private _disconnected = () => {
        const wallet = this._wallet;
        if (wallet) {
            wallet.off('disconnect', this._disconnected);

            this._wallet = null;
            this._publicKey = null;

            this.emit('error', new WalletDisconnectedError());
            this.emit('disconnect');
        }
    };
}
