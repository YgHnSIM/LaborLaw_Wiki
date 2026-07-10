# 대한민국 노동법 위키 — Schema & Operating Instructions

이 문서는 LLM이 대한민국 노동법 위키를 유지·관리할 때 따라야 할 규칙, 구조, 워크플로를 정의합니다.
사용자가 소스를 추가하거나, 질문을 던지거나, 위키를 점검하라고 요청할 때 이 스키마를 기준으로 작업합니다.

---

## 1. 디렉토리 구조

```text
LaborLaw_Wiki/
├── AGENTS.md              # 이 파일: 스키마 & 운영 지침
├── README.md              # 프로젝트 개요와 사용법
├── package.json           # 웹 빌드 명령과 Node 의존성
├── package-lock.json      # 재현 가능한 웹 빌드 잠금 파일
├── site/                  # GitHub Pages 정적 사이트 생성기·화면·테스트
├── _site/                 # 생성 결과, Git에서 제외
├── raw/                   # 원본 소스: 불변, LLM이 수정하지 않음
│   ├── assets/            # 이미지, PDF 등 첨부파일
│   └── ...                # 사용자가 추가하는 원본 문서
├── wiki/                  # LLM이 생성·관리하는 위키 페이지
│   ├── index.md           # 전체 페이지 카탈로그
│   ├── log.md             # 작업 시간순 기록
│   ├── overview.md        # 위키 홈페이지 / 전체 개요
│   ├── sources/           # 법령·판례·행정해석·회의록 등 소스 요약
│   ├── entities/          # 기관, 법원, 위원회, 단체 등 개체 페이지
│   ├── concepts/          # 노동법 개념, 조문, 판단기준 페이지
│   ├── analyses/          # 쟁점 분석, 판례 비교, 입법사, 실무 분석
│   └── meta/              # 방법론, 용어집, 템플릿
└── .obsidian/             # 옵시디언 설정
```

## 2. 페이지 규칙

### 2.1 공통 YAML 프론트매터

모든 `wiki/**/*.md` 페이지는 UTF-8·NFC로 저장하고 아래 프론트매터를 포함합니다. 날짜는 실제 날짜인 `YYYY-MM-DD` 형식으로 적고, `updated`는 `created`보다 이를 수 없습니다.

```yaml
---
title: 페이지 제목
aliases: [대안 이름, 약어]
tags: [type/concept, domain/labor-law, status/draft]
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft | active | review | archived
---
```

`type/*` 태그는 정확히 하나만 두며 디렉토리와 일치시킵니다. `status/*` 태그도 정확히 하나만 두고 `status` 값과 일치시킵니다. `sources:`는 폐기된 필드이므로 새 문서나 갱신 문서에 사용하지 않습니다.

자동 검사의 의존성 없는 YAML 부분집합과 호환되도록 프론트매터는 최상위 스칼라와 문자열 목록을 기본으로 사용합니다. 예외적으로 `case_decisions`는 아래 스키마의 JSON 스타일 인라인 매핑을 목록 항목으로 사용할 수 있습니다. 그 밖의 중첩 매핑, 앵커·별칭, 태그, 블록 문자열, 들여쓰기 없는 목록은 사용하지 않으며 콤마·콜론이 든 문자열 목록 항목은 큰따옴표로 감쌉니다.

### 2.2 출처 요약 페이지 스키마

`wiki/sources/` 페이지에는 공통 필드와 아래 필드를 모두 둡니다. `source_id`는 위키 전체에서 유일하고 안정적이어야 하며 페이지 제목이나 파일명이 바뀌어도 변경하지 않습니다. 기존 페이지 일괄 전환에는 `SRC-`와 제목 SHA-1 앞 10자리 조합을 쓸 수 있고, 새 페이지에는 사건번호·기관·법령을 반영한 의미 있는 영문 대문자 ID를 쓸 수 있습니다.

```yaml
source_id: SRC-UNIQUE-ID
source_type: 자료 유형을 나타내는 lower_snake_case 값
publisher: 실제 발행기관 또는 매체
raw_sources: [raw/원본파일.pdf]
raw_sha256: [원본파일의 64자리 SHA-256]
attachments: [raw/assets/첨부파일.png]
source_urls: [https://공식-또는-원문-주소]
retrieved: YYYY-MM-DD
related_source_refs: [SRC-RELATED-ID]
superseded_by: SRC-NEWER-ID
```

- `raw_sources`와 `raw_sha256`은 같은 순서·같은 개수로 대응하며, 해시는 실제 파일 바이트와 일치해야 합니다.
- `raw_sources`와 `attachments`는 저장소 루트 기준 `raw/...` 경로로 씁니다. 첨부는 선택 사항이며 `raw_sha256`의 대응 대상은 `raw_sources`입니다.
- 원본 파일이 없는 URL 전용 출처는 `raw_sources: []`, `raw_sha256: []`, 하나 이상의 `source_urls`, `retrieved`를 갖습니다. URL을 원본 파일처럼 가장하지 않습니다.
- 원본 파일이 있는 출처도 URL을 기록했다면 `retrieved`를 반드시 둡니다. 모든 출처는 `raw_sources` 또는 `source_urls` 중 하나 이상을 가져야 합니다.
- `publisher`는 실제 자료 발행자입니다. 보도자료가 아닌 기사에서 보도 대상 기관을 `publisher`나 `authority`로 가장하지 않습니다. 필요하면 `reported_authority`에 보도 대상 기관의 실제 이름(예: `울산지방노동위원회`)을 적습니다.
- `source_type`은 자료 자체의 성격입니다. 기사에 노동위원회 판정이 인용되어 있어도 `news`이며, 노동위원회 공식 판정문일 때만 `official_decision`입니다.
- 권장 값은 `official_law`, `official_decision`, `official_guidance`, `official_record`, `academic_paper`, `research_report`, `news`, `practitioner_commentary`, `llm_report`, `stakeholder_statement`입니다. 새 유형이 필요하면 의미가 겹치지 않는 `lower_snake_case` 값을 사용하고 운영 지침에 추가합니다.
- `related_source_refs`는 같은 사건의 선행·후속 자료처럼 직접 관련된 다른 출처 ID를 연결하는 선택 목록입니다. `superseded_by`는 이 자료를 대체한 단일 후속 출처 ID이며 이때 `legal_status: superseded`를 함께 사용합니다. 둘 다 존재하는 `source_id`만 가리키며 자기 자신을 참조하지 않습니다.

출처의 발행일과 출처가 보도·해설하는 결정일은 다음처럼 구분합니다.

```yaml
publication_date: YYYY-MM-DD
publication_period: YYYY | YYYY-MM
reported_decision_dates: [YYYY-MM-DD]
case_decisions:
  - {"case_number": "사건번호", "decision_date": "YYYY-MM-DD", "court": "기관명", "event_status": "decided"}
```

출처 요약에서 `decision_date`는 `official_decision` 원문 자체의 선고·결정일에만 사용합니다. 기사·해설처럼 일자가 확인되는 자료의 작성·발행일은 `publication_date`, 학술논문·연구보고서처럼 연도 또는 연월까지만 확인되는 자료는 `publication_period`를 사용합니다. 불명확한 날짜를 임의로 월 1일이나 1월 1일로 만들지 않습니다. 그 자료가 다루는 판정·판결일은 `reported_decision_dates`에 기록합니다. 여러 사건을 구조화한 선택 필드 `case_decisions`는 `case_number`와 `decision_date`를 필수로, `court`와 `event_status`를 선택적으로 사용합니다. 각 매핑은 JSON처럼 키와 문자열을 큰따옴표로 감싸며, 여러 줄 중첩 매핑 대신 위 예시처럼 한 줄에 씁니다. 과거의 모호한 `decision_dates` 필드는 사용하지 않습니다.

`news`, `stakeholder_statement`는 확인 가능한 `publication_date`를 기록합니다. 월간지 해설을 포함한 `practitioner_commentary`, `academic_paper`, `research_report`, `llm_report`는 `publication_date` 또는 `publication_period` 중 하나 이상을 기록합니다. 두 필드를 함께 쓰면 연도·월이 서로 일치해야 합니다.

공식 법령(`source_type: official_law`)에는 다음 필드를 추가합니다.

```yaml
authority: 법령
as_of_date: YYYY-MM-DD
effective_date: YYYY-MM-DD
version: "법률 제00000호; lsiSeq=000000"
staged_effective_dates: []
```

- `source_urls`에는 `lsiSeq`, 공포번호·공포일 등으로 특정되는 버전 고정 URL을 하나 이상 둡니다.
- `as_of_date`는 내용을 확인한 기준일, `effective_date`는 해당 현행본의 대표 시행일입니다.
- 조문별 시행일이 갈리면 `staged_effective_dates`와 본문에 예외를 기록합니다. 선택적 `law_number`는 보조 필드일 뿐 `version`을 대신하지 않습니다.

### 2.3 일반 페이지의 출처 참조

`wiki/sources/` 이외의 모든 페이지는 파일명 대신 안정적인 ID를 참조합니다.

```yaml
source_refs: [SRC-UNIQUE-ID, SRC-ANOTHER-ID]
```

- `source_refs`의 모든 값은 존재하는 출처 요약 페이지의 `source_id`와 일치해야 하며 중복할 수 없습니다.
- 개념·개체·분석 페이지는 하나 이상의 근거를 갖습니다. `index.md`, `log.md`, `overview.md`와 방법론 등 실체적 주장이 없는 메타 페이지는 빈 배열을 허용합니다.
- 본문에는 출처 요약 페이지로 향하는 인용 위키링크를 붙이지 않습니다. 근거 추적은 `source_refs`와 출처 요약 페이지에 남깁니다.

노동법 관련 페이지에는 필요한 경우 아래 필드를 추가합니다.

```yaml
legal_area: 근로기준 | 집단노동 | 산재 | 고용평등 | 비정규직 | 퇴직급여 | 중대재해 | 입법사
authority: 법령 | 대법원 | 헌법재판소 | 고용노동부 | 중앙노동위원회 | 국회 | 학설 | 기타
effective_date: YYYY-MM-DD
decision_date: YYYY-MM-DD
promulgation_date: YYYY-MM-DD
legal_status: current | amended | repealed | overruled | superseded | uncertain
confidence: high | medium | low
```

사건·절차의 진행 상태를 추적할 때는 아래 필드를 사용합니다.

```yaml
event_status: scheduled | pending | decided | appealed | final | superseded | closed | uncertain
next_review_date: YYYY-MM-DD
```

`scheduled`, `pending`, `appealed`, `uncertain`은 `next_review_date`가 필수입니다. 검토일이 지났으면 즉시 확인하고 날짜·상태를 갱신합니다. 완료된 사건은 확인 가능한 범위에서 `decided`, `final`, `superseded`, `closed`로 전환합니다.

입법 과정 분석 페이지에는 아래 필드를 추가할 수 있습니다.

```yaml
process_type: legislation_history
bill_numbers: []
assembly_session: ""
committee: ""
key_dates: []
```

### 2.4 내부 링크

- 옵시디언 `[[위키링크]]` 형식을 사용합니다.
- 처음 언급될 때 링크하고, 같은 문맥의 반복 언급은 링크 없이 씁니다.
- 커밋되는 문서의 위키링크는 실제 페이지 또는 별칭으로 해소되어야 합니다. 아직 없는 개념은 일반 텍스트로 두고 페이지를 만든 뒤 링크합니다.
- 섹션 링크는 `[[페이지명#섹션]]` 형식을 사용합니다.
- 조문, 판례, 행정해석, 입법자료는 관련 개념 페이지와 상호 링크합니다.
- 자기 페이지로 향하는 링크는 만들지 않습니다.

### 2.5 태그 체계

| 접두사 | 용도 | 예시 |
|--------|------|------|
| `type/` | 페이지 유형 | `type/source`, `type/entity`, `type/concept`, `type/analysis`, `type/meta` |
| `domain/` | 주제 영역 | `domain/labor-law`, `domain/legislation`, `domain/case-law` |
| `area/` | 노동법 세부 영역 | `area/wage`, `area/working-time`, `area/dismissal`, `area/collective-labor`, `area/industrial-accident` |
| `status/` | 상태 | `status/draft`, `status/active`, `status/review` |

### 2.6 작성 원칙

- 한국어를 기본으로 하되, 고유명사·전문용어는 필요한 경우 원어를 병기합니다.
- 법률 자문처럼 단정하지 않고, 중립적·백과사전적 톤으로 씁니다.
- 모든 실체적 주장은 프론트매터의 `source_refs:`와 `wiki/sources/` 소스 요약 페이지에 근거를 둡니다.
- 본문에는 `wiki/sources/`의 소스 요약 페이지로 향하는 인용 링크를 붙이지 않습니다.
- 본문에서 소스명을 문장 성분으로 언급할 필요가 있으면 링크 없이 일반 텍스트로 씁니다.
- 본문 위키링크는 관련 개념·개체·분석 페이지 연결을 우선합니다.
- 법령은 기준일, 시행일, 개정 여부를 명시합니다.
- 판례는 사건번호, 선고일, 법원, 핵심 법리를 명시합니다.
- 행정해석은 발행기관, 문서번호, 회시일, 후속 변경 가능성을 명시합니다.
- 모순이 발견되면 명시적으로 기록합니다: `> [!WARNING] 모순 발견`
- `> [!WARNING]`을 포함한 페이지는 해결될 때까지 `status: review`와 `status/review` 태그를 사용합니다.
- 각 페이지 하단에 `## 관련 항목` 섹션을 둡니다.

## 3. 노동법 지식 구조

### 3.1 핵심 개념 축

`wiki/concepts/`에는 다음 유형의 페이지를 둡니다.

- 근로자성, 사용자성, 임금, 평균임금, 통상임금
- 근로시간, 연장·야간·휴일근로, 휴게, 휴일, 연차유급휴가
- 해고, 징계, 전직, 배치전환, 취업규칙, 직장 내 괴롭힘
- 기간제, 단시간, 파견, 도급, 플랫폼 노동
- 노동조합, 단체교섭, 단체협약, 쟁의행위, 부당노동행위
- 산업재해, 업무상 재해, 산재보상, 산업안전보건, 중대재해
- 근로기준법 제2조처럼 조문 단위로 분석 가치가 큰 페이지

### 3.2 개체 축

`wiki/entities/`에는 다음 유형의 페이지를 둡니다.

- 고용노동부, 대법원, 헌법재판소, 중앙노동위원회, 근로복지공단
- 국회 환경노동위원회, 법제사법위원회, 본회의
- 노동조합, 사용자단체, 주요 공공기관

### 3.3 분석 축

`wiki/analyses/`에는 단순 요약보다 해석·비교·역사적 맥락이 필요한 문서를 둡니다.

- 판례 법리 변화
- 행정해석과 판례의 차이
- 쟁점별 실무 판단기준
- 법률 개정 전후 비교
- 법령안 입안 및 위원회·본회의 처리 과정
- 특정 제도 도입의 역사적 맥락과 이해관계자 입장

입법 과정 분석 문서는 아래 구성을 기본으로 합니다.

```markdown
## 개요
## 역사적 배경
## 입안 단계
## 소관 위원회 심사
## 법제사법위원회 체계·자구 심사
## 본회의 처리
## 공포 및 시행
## 주요 쟁점
## 이해관계자 입장
## 이후 개정 또는 후속 논쟁
## 관련 항목
```

국회 입법절차 자체의 일반 설명, 용어 정의, 분석 방법론은 `wiki/meta/`에 둡니다.

## 4. 소스 우선순위

대한민국 노동법 위키의 1차 근거는 공식 원문입니다.

1. 법령: 국가법령정보센터
2. 판례: 대법원 종합법률정보, 헌법재판소 결정례
3. 행정해석·정책자료: 고용노동부
4. 노동위원회 판정례: 중앙노동위원회 및 지방노동위원회 공개자료
5. 입법자료: 국회 의안정보시스템, 위원회 검토보고서, 회의록, 본회의 회의록
6. 보조자료: 국회입법조사처, 학술논문, 정부 연구용역, 신뢰할 수 있는 실무 해설

공식 원문과 사설 해설이 충돌하면 공식 원문을 우선하고, 해설은 별도 견해로 표시합니다.

## 5. 핵심 워크플로

### 5.1 소스 수집 (Ingest)

사용자가 새 소스를 `raw/`에 추가하고 처리를 요청하면:

1. 소스를 전체적으로 읽고 문서 성격을 분류합니다.
2. 핵심 인사이트 3-5개와 사용자의 관심사를 확인합니다.
3. `wiki/sources/`에 고유 `source_id`, 원본 경로·해시 또는 URL·조회일을 갖춘 소스 요약 페이지를 작성합니다.
4. 관련 개념·개체·분석 페이지를 갱신합니다.
5. 관련 개념·개체·분석 페이지의 `source_refs:`에 `source_id`를 연결하고, 본문의 소스 요약 페이지 인용 링크는 제거합니다.
6. 새 개념, 기관, 조문, 판례가 필요하면 페이지를 생성합니다.
7. `wiki/index.md`를 갱신합니다.
8. `wiki/log.md`에 작업 내용을 기록합니다.
9. `python -I -B scripts/lint_wiki.py`를 실행하고 오류를 해결합니다.

### 5.2 질의 (Query)

사용자가 질문하면:

1. `wiki/index.md`에서 관련 페이지를 식별합니다.
2. 관련 페이지와 소스 요약을 읽습니다.
3. 위키 내용 기반으로 답변하고, `[[페이지]]` 인용을 포함합니다.
4. 분석적 가치가 있는 답변은 `wiki/analyses/`에 보존합니다.
5. 필요한 경우 `wiki/index.md`와 `wiki/log.md`를 갱신합니다.

### 5.3 점검 (Lint)

사용자가 점검을 요청하거나 주기적으로:

1. 페이지 간 모순을 찾습니다.
2. 고아 페이지를 찾습니다.
3. 빨간 링크를 찾습니다.
4. 개정 법령이나 최신 판례로 대체된 오래된 정보를 찾습니다.
5. 누락된 교차참조를 찾습니다.
6. 추가 조사할 질문이나 소스를 제안합니다.
7. 출처 ID·원본 해시·URL 조회일·법령 버전과 색인의 소스 수를 검사합니다.
8. 결과를 `wiki/log.md`에 새 항목으로 추가합니다.
9. 변경 전 기준 브랜치가 있으면 `python -I -B scripts/lint_wiki.py --base <기준>`으로 원본 불변성과 로그 보존도 검사합니다.

## 6. 특수 파일

### 6.1 index.md

- 카테고리별로 모든 위키 페이지를 나열합니다.
- 각 항목은 `- [[페이지명]] — 한 줄 요약 (소스 N개)` 형식을 기본으로 합니다.
- `N`은 출처 요약 페이지에서는 `raw_sources`와 `source_urls` 항목 수의 합, 그 밖의 페이지에서는 `source_refs` 항목 수입니다.
- `index.md` 자신을 제외한 모든 위키 페이지를 정확히 한 번 수록하며, 페이지 유형에 맞는 카테고리에 둡니다.
- 새 페이지 생성·삭제 시 반드시 갱신합니다.

### 6.2 log.md

- `log.md`는 append-only 감사기록입니다. 기존 작업 항목의 본문·순서·제목을 수정하거나 삭제하지 않습니다.
- 시간순 기록이며 새 항목은 마지막 기존 작업 항목 다음, `## 관련 항목` 앞에 추가합니다.
- 형식: `## [YYYY-MM-DD] 작업유형 | 제목`
- 작업유형은 Git 커밋과 동일하게 `ingest`, `analysis`, `update`, `lint`, `maintenance`, `refactor`, `remove`, `chore` 중 하나만 사용합니다.
- 각 항목에 변경된 페이지 목록을 포함합니다.
- 과거 기록의 오류를 발견하면 원문을 고치지 않고 새 `maintenance` 항목에서 정정 대상 헤더와 사유를 기록합니다.
- 프론트매터 `updated`와 마지막의 `## 관련 항목`은 관리할 수 있지만, 기준 브랜치에 존재하던 작업 항목은 문자·공백·순서가 보존되어야 합니다. 플랫폼 줄바꿈은 `.gitattributes`의 LF 정규형으로 비교합니다.

### 6.3 overview.md

- 위키 홈페이지입니다.
- 전체 지식베이스의 요약과 현재 상태를 제공합니다.
- 개별적 근로관계, 집단적 노사관계, 산업안전·산재, 고용평등·비정규직, 입법사 등 주요 영역으로 안내합니다.

## 7. 품질 기준

- 정확성: 모든 주장은 소스에 근거합니다.
- 기준일: 법령·행정해석·입법 과정은 날짜를 명시합니다.
- 일관성: 페이지 간 모순은 없애거나 경고로 표시합니다.
- 연결성: 관련 페이지는 상호 링크합니다.
- 최신성: 새 소스 수집 시 관련 페이지를 함께 갱신합니다.
- 가독성: 구조적이고 스캔 가능한 형식으로 씁니다.

## 8. LLM 행동 원칙

1. `raw/` 디렉토리의 파일은 절대 수정하지 않습니다.
2. `wiki/` 디렉토리의 파일은 생성·수정·삭제할 수 있습니다.
3. 루트의 `AGENTS.md`, `README.md`, `.gitignore`는 사용자가 요청한 경우에만 수정합니다.
4. 확실하지 않은 것은 사용자에게 묻습니다.
5. 큰 변경 전에는 무엇을 할지 먼저 설명합니다.
6. 모든 위키 작업은 `wiki/log.md`에 새 항목으로 기록하며 과거 항목을 고치지 않습니다.
7. `wiki/index.md`는 항상 최신 상태를 유지합니다.
8. 사용자의 관심사와 맥락을 기억하고 반영합니다.
9. 기존 `raw/` 파일은 이름 변경·이동·삭제도 수정으로 간주하며 금지합니다. 새 원본 추가만 허용합니다.
10. 완료 전 `python -I -B scripts/lint_wiki.py`를 실행하고, Git 기준점이 있으면 `--base` 검사도 실행합니다.
11. 웹 생성기·화면·배포 설정을 바꾸면 `npm test`와 `npm run build`도 실행하고 `_site/`는 커밋하지 않습니다.

## 9. Git 커밋 메시지 규칙

커밋 메시지는 `type: 대상 + 작업` 형식을 기본으로 합니다.

```text
type: 대상 작업
```

예시:

```text
ingest: 노조법 시행 초기 사용자성 노동위 동향 반영
analysis: 교섭창구 단일화 헌재 결정 해설 추가
lint: 핵심 개념 페이지와 색인 정리
refactor: 사용하지 않는 .gitkeep 제거
remove: 임시 강의 초안 삭제
```

작업유형은 `wiki/log.md`와 아래 통제어휘를 공유합니다.

| 타입 | 용도 |
|------|------|
| `ingest` | 새 원문·기사·판례·연구자료를 `raw/`와 `wiki/sources/`에 반영 |
| `analysis` | 쟁점 분석, 판례 비교, 법리 정리 등 해석적 페이지 추가·보강 |
| `update` | 기존 개념·개체·개요 페이지의 일반 갱신 |
| `lint` | 색인, 링크, 프론트매터, 고아 페이지, 문서 구조 정리 |
| `maintenance` | 색인·로그·개요, 백업 점검 등 위키의 일상 유지관리 |
| `refactor` | 의미 변화 없는 파일 구조·설정·관리 파일 정리 |
| `remove` | 임시 문서, 중복 문서, 불필요 파일 삭제 |
| `chore` | 운영 지침, README, 저장소 관리성 변경 |

변경 범위가 넓거나 추적 가치가 큰 커밋은 본문에 아래 항목을 간단히 적습니다.

```text
- sources: 추가·갱신한 주요 소스
- concepts: 추가·갱신한 주요 개념
- entities: 추가·갱신한 주요 개체
- analyses: 추가·갱신한 주요 분석
- maintenance: index.md, log.md, overview.md 등 정리 내용
```

## 10. 자동 점검과 저장소 정책

### 10.1 로컬 점검

```text
python -I -B -m unittest discover -s tests -p "test_*.py"
python -I -B scripts/lint_wiki.py
python -I -B scripts/lint_wiki.py --base origin/main
npm ci
npm test
npm run build
```

첫 명령은 린터 단위 테스트를 실행합니다. 두 번째 명령은 현재 트리의 프론트매터, 태그, 링크·섹션, 색인, 출처 계보, 원본 해시, 법령 버전, 경고 상태, UTF-8·NFC를 검사합니다. 세 번째 명령은 이에 더해 기준점 이후 기존 `raw/` 파일의 수정·삭제·이동 금지, 기존 로그 항목 보존, 위키 변경 시 새 로그 항목 추가를 검사합니다. 검토기한 경과는 기본적으로 경고이며 `--strict-warnings`를 붙이면 오류로 취급합니다.

### 10.2 CI

`.github/workflows/lint-wiki.yml`은 push와 pull request에서 같은 검사를 실행합니다. pull request에서는 대상 커밋, 일반 push에서는 push 직전 커밋을 `--base`로 사용해 불변성 규칙까지 검사합니다. 최초 push와 수동 실행은 비교 기준 없이 현재 트리를 검사합니다. 오류가 남은 변경은 병합하지 않습니다.

`.github/workflows/pages.yml`은 `main` push와 수동 실행에서 기준 커밋의 신뢰된 린터와 현재 린터, 웹 생성기 테스트와 빌드를 거쳐 GitHub Pages artifact를 배포합니다. `actions/configure-pages`가 제공하는 실제 `base_path`와 `base_url`을 사용하며, 배포 job만 `pages: write`와 `id-token: write` 권한을 가집니다. 저장소 Pages의 Source는 GitHub Actions로 설정합니다.

### 10.3 줄바꿈·원본 바이트

`.gitattributes`는 위키·운영 문서·스크립트를 LF 텍스트로 정규화하고 `raw/** -text`로 원본의 바이트 자동 변환을 막습니다. 이미 커밋된 원본은 내용뿐 아니라 이름과 위치도 바꾸지 않습니다. 잘못 추가한 원본을 정리해야 할 때는 사용자 승인, 사유를 적은 로그, 별도 커밋이 모두 필요합니다.

### 10.4 웹 생성 규칙

- `wiki/`를 웹 콘텐츠의 단일 원본으로 사용하고 생성된 `_site/`를 직접 수정하거나 커밋하지 않습니다.
- `overview.md`는 `/`, `index.md`는 `/catalog/`, `log.md`는 `/log/`로 내보냅니다. 출처 페이지 URL은 안정적인 `source_id`를 사용합니다.
- 위키링크는 파일 stem, 프론트매터 `title`, `aliases`를 모두 해석합니다. 해소되지 않는 링크나 중복 URL이 있으면 빌드를 실패시킵니다.
- 본문 H1은 레이아웃 H1과 중복하지 않도록 제거하고 최종 HTML마다 H1을 하나만 둡니다.
- `source_refs`, `related_source_refs`, `superseded_by`는 실제 출처 페이지 링크로 만들고, 출처 페이지에는 일반 페이지의 역참조를 표시합니다.
- 검색 색인에는 제목·별칭·본문·파일 stem·출처 ID·발행기관·사건번호·의안번호를 포함합니다. `index.md`와 `log.md`의 반복 본문은 검색 가중치 오염을 막기 위해 제외합니다.
- `raw/` 파일은 Pages artifact에 복사하지 않습니다. 원본 링크는 배포 커밋 SHA에 고정된 GitHub blob URL을 사용합니다.
- 모든 내부 링크와 정적 자산에는 GitHub Pages의 동적 기준 경로를 적용합니다. 모바일 탐색, 키보드 검색, 콜아웃, 표와 상태 표시는 브라우저 검증 대상입니다.
