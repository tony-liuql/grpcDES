import * as dns from 'dns';
import { EventEmitter } from 'events';

import * as Bluebird from 'bluebird';
import * as debug from 'debug';
import * as _ from 'lodash';

Promise = Bluebird as any;

const log = debug('grpcHelper:naming');

export interface Address {
  addr: string;
}

export enum UpdateOp {
  ADD,
  DEL,
}

export interface Update {
  op: UpdateOp;
  addr: string;
}

export interface Watcher {
  next(): Promise<Update[]>;
  close(): Promise<void>;
}

export interface Resolver {
  resolve(target: string): Watcher;
}

export class DNSResolver implements Resolver {
  resolve(target: string): Watcher {
    return new DNSWatcher(async function(): Promise<Address[]> {
      const resolveSrv = Promise.promisify(dns.resolveSrv);
      const recoreds = await resolveSrv(target);

      return _.map(recoreds, record => {
        return <Address>{
          addr: `${record.name}:${record.port}`,
        };
      });
    });
  }
}

export class StaticResolver implements Resolver {
  resolve(target: string): Watcher {
    return new StaticWatcher(async function(): Promise<Address[]> {
      const hosts = target.split(',');

      return _.map(hosts, host => {
        return <Address>{
          addr: host,
        };
      });
    });
  }
}

interface AddrMap {
  [addr: string]: Address;
}

export class DNSWatcher extends EventEmitter implements Watcher {
  private interval: number;
  private addrMap: AddrMap = {};
  private resolveAddrs: () => Promise<Address[]>;
  private updates: Update[] = [];

  constructor(resolveAddrs: () => Promise<Address[]>) {
    super();

    this.interval = 100;
    this.resolveAddrs = resolveAddrs;

    this.update();
  }

  private async update(): Promise<void> {
    const addrs = await this.resolveAddrs();

    const newAddrMap = _.keyBy(addrs, 'addr');

    _.each(this.addrMap, (a, k) => {
      if (!newAddrMap[k]) {
        this.updates.push(<Update>{
          op: UpdateOp.DEL,
          addr: k,
        });
      }
    });

    _.each(newAddrMap, (a, k) => {
      if (!this.addrMap[k]) {
        this.updates.push(<Update>{
          op: UpdateOp.ADD,
          addr: k,
        });
      }
    });

    if (this.updates.length) {
      this.emit('updates');
    }

    this.addrMap = newAddrMap;

    setTimeout(this.update.bind(this), this.interval);
  }

  public async next(): Promise<Update[]> {
    log('wait for updates');
    return new Promise<Update[]>(resolve => {
      if (this.updates.length) {
        resolve(this.updates);
        this.updates = [];
        return;
      }

      this.once('updates', () => {
        if (this.updates.length) {
          resolve(this.updates);
          this.updates = [];
        }
      });
    });
  }

  public async close(): Promise<void> {
  }
}

export class StaticWatcher extends EventEmitter implements Watcher {
  private resolveAddrs: () => Promise<Address[]>;
  private updates: Update[] = [];

  constructor(resolveAddrs: () => Promise<Address[]>) {
    super();

    this.resolveAddrs = resolveAddrs;
    this.update();
  }

  private async update() {
    const addrs = await this.resolveAddrs();
    this.updates = _.map(addrs, a => {
      return <Update>{
        addr: a.addr,
        op: UpdateOp.ADD,
      };
    });

    this.emit('updates');
  }

  public async next(): Promise<Update[]> {
    return new Promise<Update[]>(resolve => {
      if (this.updates.length) {
        resolve(this.updates);
        this.updates = [];
        return;
      }

      this.once('updates', () => {
        if (this.updates.length) {
          resolve(this.updates);
          this.updates = [];
        }
      });
    });
  }

  public async close(): Promise<void> {
  }
}