'use client';
import { useEffect, useState } from 'react';
import { api, isUnauthorized } from './api';
import type { CurrentUser } from './types';

/**
 * 当前用户（模块级缓存，一次会话只取一次）。
 * 权限判定一律走 src/domain/permissions.ts 的纯函数，不在组件里写 role === 'admin'。
 */
let cache: CurrentUser | null = null;
let inflight: Promise<CurrentUser | null> | null = null;

function fetchMe(): Promise<CurrentUser | null> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .me()
      .then((u) => {
        cache = u;
        return u;
      })
      .catch((e) => {
        if (isUnauthorized(e)) cache = null;
        return null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useMe(): { user: CurrentUser | null; ready: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(cache);
  const [ready, setReady] = useState(Boolean(cache));

  useEffect(() => {
    let alive = true;
    void fetchMe().then((u) => {
      if (!alive) return;
      setUser(u);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { user, ready };
}
