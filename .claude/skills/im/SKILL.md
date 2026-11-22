---
name: im
description: Send and read messages via the team chat server at 192.168.5.116:9999. Triggers: /im, /ims, 聊天
---

# IM 团队聊天

通过中转服务器 `192.168.5.116:9999` 收发消息。

## 命令

```
/im-login                 登录获取 token（首次必做）
/im-logout                注销 token
/im <消息>                广播消息
/im --to <名字> <消息>     私聊某人
/im                       查看最近 20 条消息
/im --online              查看在线用户
```

## 登录（首次必做）

```bash
GIT_USER=$(git config user.username 2>/dev/null || git config user.name 2>/dev/null || echo "anon")
RESP=$(curl -s -X POST http://192.168.5.116:9999/login \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$GIT_USER\"}")
echo "$RESP"  # {"token":"abc123...","user":"wangzk"}
echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" > $HOME/.im-token
echo "Token saved to ~/.im-token"
```

## 注销

```bash
TOKEN=$(cat $HOME/.im-token 2>/dev/null)
curl -s -X POST http://192.168.5.116:9999/logout \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}"
rm $HOME/.im-token
```

## 发送消息

```bash
TOKEN=$(cat $HOME/.im-token 2>/dev/null)
# 广播
curl -s -X POST http://192.168.5.116:9999/send \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"text\":\"<消息>\"}"
# 私聊
curl -s -X POST http://192.168.5.116:9999/send \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"text\":\"<消息>\",\"to\":\"<用户名>\"}"
```

## 查看消息

```bash
TOKEN=$(cat $HOME/.im-token 2>/dev/null)
curl -s "http://192.168.5.116:9999/history?limit=20&token=$TOKEN" | python3 -c "
import json, sys
msgs = json.load(sys.stdin)['messages']
for m in msgs:
    to_s = f' → {m[\"to\"]}' if m.get('to') else ''
    print(f'[{m[\"from\"]}{to_s}] {m[\"text\"]}')
"
```

## 在线用户

```bash
curl -s http://192.168.5.116:9999/online
```
