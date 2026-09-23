# 줼리 · Jelly

개인 서버와 SSH로 연결된 서버의 프로젝트별 터미널을 웹에서 사용하는 작은 작업실.
React + TypeScript + Vite와 xterm.js로 만든 웹 화면을 기존 HTTP/WebSocket 서버가 함께 제공한다.

Jelly is a personal web terminal for persistent local and SSH sessions over Tailscale.
It uses dedicated tmux sockets and requires no Jelly installation on SSH targets.

```text
폰 / 컴퓨터 브라우저 → 같은 Tailscale VPN (HTTP/WebSocket)
                    ↓
         Jelly API (서버의 Tailscale IP:47821)
                    ↓
       ├─ 로컬 전용 tmux → 셸 → Codex / Claude Code
       └─ SSH → 원격 전용 tmux → 셸 → Codex / Claude Code
```

연결을 닫거나 API를 재시작해도 셸은 계속 실행된다. 서버 재부팅이나 tmux 서버 종료는
실행 중인 프로세스를 종료한다. 프로젝트·세션 메타데이터는 SQLite에 남는다.

## 시작

Linux, Node.js 24, tmux 3.2 이상이 필요하다. `node-pty`는 네이티브 모듈이므로
사전 빌드 바이너리를 사용할 수 없는 환경에서는 Python 3, make, C++ 컴파일러가 필요하다.

```bash
git clone https://github.com/jae-heo/jelly.git ~/jelly
cd ~/jelly
npm ci
npm run build
npm start
```

로컬 개발 기본 주소는 `http://127.0.0.1:47821`.
`JELLY_HOST=tailscale`을 설정하면 연결된 서버 자신의 Tailscale IPv4 주소에만 바인딩한다.
모든 인터페이스(`0.0.0.0`), LAN·공인 IP로 여는 설정은 거부한다.
첫 실행 시 `.data/token`에 API 토큰을 생성한다. 토큰·DB·소켓은 `.data/`에만 저장되며
Git에서 제외된다. `.data`는 0700, 토큰은 0600이다. 토큰 내용을 로그나 Git에 기록하지 않는다.

## 웹에서 사용하기

서버 주소를 브라우저에서 열고 연결 키를 입력한다. 키는 서버 터미널에서 확인한다.

```bash
cat ~/jelly/.data/token
```

기본적으로 현재 탭에서만 인증을 기억한다. 로그인 화면에서 ‘이 기기에서 연결 기억하기’를
선택하면 해당 브라우저에 저장한다. 로그아웃하면 저장된 키를 지운다.

1. **프로젝트 추가**: 프로젝트 서버에서 ‘이 서버’ 또는 SSH 별칭을 고르고,
   ‘폴더 찾기’로 그 서버의 폴더를 둘러본 뒤 ‘이 폴더 선택’을 누른다.
   홈·상위 폴더·경로 표시줄로 이동하고, 숨김 폴더 표시와 현재 폴더의 이름 검색을 사용할 수 있다.
   비어 있는 프로젝트 이름은 선택한 폴더 이름으로 채운다. 전체 경로를 직접 입력해도 된다.
2. **새 세션**: 해당 폴더에서 터미널을 열고 `codex`, `claude` 또는 원하는 명령을 실행한다.
3. **더 보기(⋯) → 연결 끊기**: 셸은 계속 실행된다. 창을 닫거나 다른 기기에서 같은 세션을 선택해도 이어진다.
4. **기록**: 최근 출력 2,000줄과 현재 화면을 읽는다. 별도 파일로 저장하는 로그는 아니다.
5. **더 보기(⋯) → 세션 종료**: 확인 창을 거쳐 실행 중인 프로그램과 셸을 종료한다.

상단 한 줄에 프로젝트·세션과 연결 상태를 표시한다. 폰에서는 왼쪽 위 도마뱀 로고로 프로젝트와
세션을 선택하며, 오른쪽에는 기록과 더보기 버튼이 있다. 서버·전체 경로는 더보기에서 확인한다.
하단 기본 줄에는 Esc·Tab·Ctrl C·붙여넣기·Enter·Ctrl R을 표시한다. 좁은 화면에서는
키 줄을 가로로 스크롤한다. 키보드 버튼으로 한글·명령 입력창을 열고 접을 수 있으며,
접었다 펼쳐도 작성 중인 텍스트는 남는다. 오른쪽 펼치기 버튼에서는 다음 키를 선택한다.

- 이동: 네 방향키, Home/End, Page Up/Down, Backspace, Delete, Shift+Tab, Insert.
- Ctrl: A/B/D/E/F/G/K/L/N/U/W/Z. C와 R은 기본 줄에 있다.
- F1–F12: 기능 키 전체.

`Ctrl + …`는 입력창에 영문 키 하나를 적어 조합을 전송한다. 여러 글자는 전송하지 않는다.
붙여넣기와 입력창은 텍스트만 전달하며, Enter를 자동으로 추가하지 않는다. 입력창의 보내기
버튼이나 Enter로 내용을 전송한 뒤, 실행하려면 하단 보조 키 Enter를 별도로 누른다.
화면의 보조 키는 터미널에 직접 전달된다. 입력창에서 Shift+Enter는 줄바꿈을 넣는다.
보내기·보조 키를 눌러도 입력 포커스를 유지하며, 열린 키보드 버튼을 다시 누르면 입력창과
키보드를 함께 닫는다. 키보드가 화면 크기를 바꾸는 동안 터미널 재조정은 잠시 모아서 처리한다.
키보드가 표시되면 하단 안전 여백을 제거하고, 닫히면 복원한다. 입력창 포커스와 화면 높이
변화를 함께 확인하므로 외장 키보드 사용 시에는 여백을 유지한다.
데스크톱에서도 터미널에 직접 입력하거나 하단 키보드 버튼으로 입력창을 열 수 있다.
상단 **더 보기(⋯) → 글씨 크기**의 −/+ 버튼으로 10~24px 범위에서 조절하고 기본값 14px로
되돌릴 수 있다. 크기는 브라우저에 저장되며, 조절할 때 실행 중인 세션이나 연결을 재시작하지 않는다.
가장 최근 접속한 기기가 세션을 제어하며 이전 기기에는 재연결 안내를 표시한다.

같은 프로젝트에서 최근에 연 세션 3개는 화면과 연결을 메모리에 유지한다. 이 세션을 오갈 때는
연결을 다시 만들지 않으며, 처음 열거나 보관 범위에서 벗어난 세션은 다시 접속한다.
프로젝트 변경·새로고침·로그아웃 시 보관을 해제한다. 셸은 서버에서 계속 실행된다.
숨긴 세션은 입력·크기 변경·자동 재접속을 하지 않는다. 다른 기기가 접속을 가져갔다면
해당 세션으로 돌아와 ‘다시 연결’을 눌러야 한다. 터미널 내용은 브라우저 저장소에 기록하지 않는다.

주소창 없이 사용하려면 지원되는 브라우저에서 **더 보기(⋯) → 전체 화면**을 누른다.
같은 메뉴의 **전체 화면 종료** 또는 브라우저 종료 동작으로 돌아온다. 전환 중에도 세션과
연결은 유지된다. 전체 화면은 버튼을 누를 때만 요청하며 새로고침 후 자동 진입하지 않는다.
아이폰은 브라우저 공유 메뉴에서 **홈 화면에 추가**한 뒤 해당 아이콘으로 실행할 수 있도록
웹 앱 메타 설정을 제공한다. 일반 탭에서 터미널 스와이프는 브라우저 주소창을 자동으로 접지 않는다.
홈 화면에는 도마뱀 아이콘을 사용한다. 기존 아이콘이 글자로 표시되면 브라우저에서
새로고침한 뒤 **홈 화면에 추가**를 다시 진행한다.
아이콘 원본은 `web/public/jelly.svg`이며, 변경 시 `npm run build:icons`로 PNG를 재생성하고
`npm run build:web`으로 반영한다.

웹 화면과 API는 같은 주소와 포트를 사용하므로 별도 웹 서버나 열린 포트가 필요하지 않다.

## SSH 서버의 프로젝트

오른쪽 위 **더 보기(⋯) → SSH 서버 관리**에서 줼리 노드의 SSH 별칭을 모두 확인·검색하고 연결을 시험할 수 있다.
프로젝트 추가 화면에서도 **SSH 설정 별칭** 목록에서 바로 선택할 수 있다.
`~/.ssh/config`, 시스템 SSH 설정과 `Include` 파일의 구체적인 `Host` 이름을 읽는다.
`Host *`, `Host dev-*` 같은 패턴은 접속할 서버 이름이 아니므로 목록에서 제외한다.
사용자·포트·키·ProxyJump 등 실제 접속 설정은 OpenSSH가 해석한다.

별칭이 없는 서버는 **SSH 서버 추가**에서 `user@host` 형태로 등록한다.
포트·줼리 서버에 있는 키 파일 경로는 필요할 때 직접 지정할 수 있다.
비밀번호/키 파일의 내용은 웹에 입력하지 않는다. 줼리 서비스 계정에서 비밀번호 입력 없이
SSH 연결이 가능해야 하며, 처음 연결하는 호스트의 키는 서버 터미널에서 먼저 확인한다.
SSH 키가 암호화되어 있다면 줼리 서비스에서 접근 가능한 SSH agent에 로드되어 있어야 한다.

원격에는 **SSH, POSIX 셸, tmux 3.2 이상**만 필요하다. 줼리·Node.js·Python·별도 에이전트는
설치하지 않는다. 폴더 목록은 SSH로 읽고 터미널은 원격 tmux에 유지한다.
기존 원격 tmux와 다른 `jelly-<instanceId>` 소켓을 사용하며 원격 사용자 설정을 변경하지 않는다.
줼리의 `.data/instance-id`는 재시작 후 같은 원격 tmux를 찾는 데 사용하므로 DB와 함께 보관한다.

같은 SSH 서버의 상태 조회·폴더 탐색·터미널 연결은 인증된 연결을 재사용해 세션 전환 지연을 줄인다.
연결 소켓은 줼리의 비공개 데이터 폴더에 두며, 사용하지 않는 연결은 60초 뒤 종료한다.
사용자의 SSH 공유 연결과는 분리한다. 명시적인 연결 확인과 세션 생성·종료는 새 SSH 연결을 사용한다.

서버가 응답하지 않으면 세션을 **서버 연결 안 됨**으로 표시한다. 연결이 복구되면 상태를 다시 확인한다.
서버에 접속할 수 없는 동안에는 종료·삭제를 완료했다고 처리하지 않는다.
같은 경로도 서로 다른 서버에서 별도 프로젝트로 등록할 수 있다.
SSH 서버 등록을 지우려면 해당 서버의 프로젝트를 먼저 목록에서 삭제한다.

## CLI

서버 터미널에서도 사용할 수 있다.

```bash
npm run cli -- project-add 줼리 "$PWD"
npm run cli -- projects
npm run cli -- session-new PROJECT_ID 개발
npm run cli -- attach SESSION_ID
```

`attach` 안에서 `codex`나 `claude`를 실행할 수 있다. **Ctrl+]는 연결만 해제**한다.
Ctrl+C는 실행 중인 프로그램에 전달된다. 프로젝트는 기존 디렉터리를 등록하며,
프로젝트 삭제는 디스크의 소스 파일을 삭제하지 않는다.
서버에서 실행하는 CLI는 `.data/endpoint.json`에서 현재 접속 주소를 자동으로 읽는다.

```bash
npm run cli -- sessions
npm run cli -- history SESSION_ID 1000
npm run cli -- session-stop SESSION_ID
npm run cli -- session-delete SESSION_ID
```

## Tailscale 전용 접속

1. 서버와 접속 기기를 같은 tailnet에 연결한다.
2. 서버에서 `JELLY_HOST=tailscale`로 줼리를 실행한다.
3. 다른 기기에서 `http://서버의-Tailscale-IP:47821`로 접속한다.

```bash
JELLY_HOST=tailscale npm start
```

Tailscale Serve, Funnel, HTTPS 활성화나 공유기 포트 포워딩은 필요하지 않다.
기기 사이의 전송은 Tailscale이 암호화한다. 기존 Tailscale 설정을 변경하지 않는다.
Tailscale 접근 정책으로 해당 서버의 포트를 사용할 계정·기기를 제한할 수 있다.
API 인증은 Tailscale과 별도로 유지한다.

firewalld를 사용하는 서버에서는 Tailscale 인터페이스가 속한 구역에도 줼리 포트를 허용해야 한다.
`firewall-cmd --get-zone-of-interface=tailscale0` 결과가 전용 `tailscale` 구역인 경우,
서버에서 다음 명령으로 현재 실행과 재부팅 후 설정을 모두 적용한다.

```bash
sudo firewall-cmd --zone=tailscale --add-port=47821/tcp
sudo firewall-cmd --permanent --zone=tailscale --add-port=47821/tcp
```

IP만 입력하면 기본 80번 포트로 접속하므로 주소에 `http://`와 `:47821`을 포함한다.
서버 내부의 상태 확인이 성공해도 다른 기기의 접속은 방화벽에서 거부될 수 있다.

systemd로 줼리를 실행 중이라면 다음 스크립트로 직접 접속을 설정·검증할 수 있다.
서버의 Tailscale IP를 확인하고 줼리 설정에 `JELLY_HOST=tailscale`을 저장한다.
API를 재시작한 뒤 IP 주소로 HTTP 인증과 WebSocket 터미널 왕복을 확인한다.

```bash
node scripts/enable-tailnet.mjs
```

검증 결과는 비공개 `.data/tailnet-check.json`에 저장된다. 이 검증은 서버 자신이
Tailscale IP로 접속하는 것이므로 별도 기기의 네트워크 접속도 직접 확인한다.
Tailscale이 연결되지 않으면 원격 모드의 서버 시작을 실패시킨다. LAN으로 우회하지 않는다.

바인딩 IP와 해당 서버의 MagicDNS 전체 이름은 Origin 허용 목록에 자동 추가한다.
다른 별칭을 쓸 때는 `JELLY_ORIGINS=http://별칭:47821`에 정확한 origin을 설정한다.
끝에 `/`를 붙이지 않는다. CLI는 Origin 헤더 없이 Bearer
토큰으로 접속한다. 원격 CLI는 `JELLY_URL`과 안전하게 전달한 `JELLY_TOKEN_FILE`을 사용한다.
HTTP CLI 연결은 loopback 또는 Tailscale IPv4 주소로 제한한다. 원격 CLI는 IP를 사용한다.
개인용 서버 셸 권한을 제공하므로 토큰 소유자는 서버 계정 권한으로 명령을 실행한다.

```bash
curl http://TAILSCALE_IP:47821/healthz
```

실행 가능한 전체 HTTP/WS 계약은 [docs/API.md](docs/API.md)를 참고한다.

## 상시 실행

```bash
npm run build
node scripts/install-service.mjs
systemctl --user status jelly
systemctl --user restart jelly
journalctl --user -u jelly -n 30
```

환경 설정은 Git에 포함되지 않는 `.data/service.env`에 저장한다.

```ini
JELLY_PORT=47821
JELLY_HOST=tailscale
```

설정 변경 후 서비스를 재시작한다. 사용자 systemd 버스가 자동 인식되지 않으면
`XDG_RUNTIME_DIR=/run/user/$(id -u)`와
`DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus`를 설정한다.
로그아웃 후·부팅 직후에도 사용자 서비스가 동작하려면 해당 계정의 linger 설정이 필요하다
(`loginctl show-user "$USER" -p Linger`로 확인, 필요하면 관리자가 `loginctl enable-linger USER` 실행).

서비스는 `KillMode=process`를 사용해 API 종료 시 독립 tmux 서버를 유지한다.
서비스를 제거할 때도 터미널 세션은 남는다. 세션 정리는 Jelly의 명시적 종료 API로 한다.
한 데이터 디렉터리에는 API 인스턴스를 하나만 실행한다.

## 동작과 제한

- 세션마다 셸 하나, tmux 창 하나를 사용한다. 분할 창·에디터·Git UI는 범위 밖이다.
- 한 세션은 가장 최근 연결이 키보드와 화면 크기를 제어한다. 이전 연결은 코드 4001로 닫힌다.
- tmux는 기존 사용자 tmux와 다른 `.data/tmux.sock`을 사용하고 사용자 tmux 설정을 읽지 않는다.
- 새로 붙으면 현재 화면을 다시 그린다. 과거 기록 전체를 브라우저 스크롤백에 재생하지는 않는다.
- 터미널 안에서 손가락으로 위아래로 밀거나 마우스 휠을 돌리면 tmux의 이전 출력을 볼 수 있다.
  최신 출력까지 내려오거나 하단 `Esc`를 누르면 입력 화면으로 돌아온다. SSH 세션에도 동일하게 적용된다.
- 과거 출력은 `history` API에서 일반 텍스트로 읽는다. 최대 10,000줄의 tmux 기록이며,
  TUI의 대체 화면과 일반 셸 스크롤백은 다르다. 영구 감사 로그가 아니다.
- 셸이 자연 종료하면 `exited`, 명시적 종료는 `stopped`, tmux 세션이 사라지면 `lost`다.
  원격 상태를 조회할 수 없으면 `unreachable`이며, 세션 종료와 구분한다.
- 느린 연결에는 출력 흐름 제어와 버퍼 제한을 적용한다. 재접속은 누락 바이트 재전송이 아니라
  tmux의 현재 화면 재표시다.
- API 입력은 64 KiB, 터미널 입력 메시지는 16 KiB, 입력 속도는 연결당 초당 256 KiB 제한이다.
- Node 24의 `node:sqlite`는 experimental 경고를 출력할 수 있다. 데이터는 일반 SQLite 형식이다.
- 모바일 터치를 에뮬레이션한 Chromium에서 양방향 스크롤·입력 복귀·재접속,
  한글 전달·입력창 배치·화면 축소를 검증했다.
  실제 휴대폰의 한글 IME, 터치 스크롤, 가상 키보드·회전 동작은 별도 확인이 필요하다.
- Linux 개인 서버를 대상으로 한다. 다중 사용자 샌드박스·공개 인터넷 서비스·서버 재부팅 후
  프로세스 복원·알림은 이번 버전에 포함하지 않는다.

## 검증과 Goal

```bash
npm test
npm run check
npm run test:ssh # Docker 필요: SSH/tmux만 있는 격리 서버로 검증
npx playwright install chromium # 브라우저 테스트 최초 실행 전
npm run test:web # Docker 필요: 로컬·SSH 웹 흐름 검증
```

테스트는 `.data/test-*`의 독립 DB와 tmux 소켓을 사용한다. 정상 재시작과 SIGKILL,
동시 접속 인계, 인증, Unicode 입출력, 화면 크기, 느린 소비자, 종료 상태를 실제 프로세스로 검증한다.
브라우저 테스트는 `.data/browser-test-*`에 별도 서버·DB·tmux를 만들고 로그인부터
프로젝트 추가, 명령 실행, 기록, 재접속, 기기 간 인계, 세션 종료를 검증한다.
화면 캡처는 Git에서 제외한 `.data/screenshots/`에 저장한다.
SSH 테스트는 `test/ssh-container/Dockerfile`로 테스트 이미지를 한 번 빌드하고,
127.0.0.1에만 노출한 임시 컨테이너와 임시 SSH 키를 사용한 뒤 정리한다. 테스트 대상에 줼리는 없다.
[Goal 실행 지침](docs/GOAL.md), [검증 기록](docs/VERIFICATION.md).

웹 개발 시에는 `JELLY_HOST=127.0.0.1 JELLY_ORIGINS=http://127.0.0.1:5173 npm start`로
백엔드를 실행한 뒤 `npm run dev:web`로 Vite를 실행하고 `http://127.0.0.1:5173`을 연다.
Vite의 `/api` 프록시는 `127.0.0.1:47821`을 사용한다. 운영은 `npm run build` 후 기존
Jelly 서비스만 실행하며, `web/` 소스가 `dist/web/`으로 빌드된다.

참고: [tmux](https://github.com/tmux/tmux/wiki/Getting-Started),
[node-pty](https://github.com/microsoft/node-pty), [ws](https://github.com/websockets/ws),
[Tailscale 기기 직접 연결](https://tailscale.com/docs/how-to/connect-to-devices).
SSH 설정 참고: [OpenSSH ssh](https://man.openbsd.org/ssh),
[ssh_config](https://man.openbsd.org/ssh_config), [tmux](https://man.openbsd.org/tmux).

## 라이선스 / License

[MIT](LICENSE) · Copyright (c) 2026 jae-heo.
