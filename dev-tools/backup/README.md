# Backup automático do Firestore -> Excel

Gera um arquivo `.xlsx` com **uma aba por coleção** do Firestore, salvo em `dev-tools/backup/backups/`. Pensado pra rodar agendado no Windows e ter sempre uma cópia local em caso de emergência (sem internet ou problema com o Firebase).

---

## 1. Instalação (uma vez só)

### 1.1 Instalar Node.js

Baixe e instale a versão LTS em https://nodejs.org . Depois, abra o **PowerShell** e confirme:

```powershell
node --version
npm --version
```

### 1.2 Instalar as dependências

No PowerShell, dentro da pasta do projeto:

```powershell
cd C:\Users\073712631\Desktop\app-geh\dev-tools\backup
npm install
```

Isso baixa `firebase-admin` e `xlsx` em `node_modules/`. Não precisa repetir.

### 1.3 Baixar a chave de serviço do Firebase

1. Abra https://console.firebase.google.com/project/app-geh-cc577/settings/serviceaccounts/adminsdk
2. Clique em **"Gerar nova chave privada"** -> **"Gerar chave"**.
3. Vai baixar um arquivo JSON tipo `app-geh-cc577-firebase-adminsdk-XXXXX.json`.
4. **Renomeie pra `service-account.json`** e mova pra esta pasta:

   ```
   C:\Users\073712631\Desktop\app-geh\dev-tools\backup\service-account.json
   ```

> **IMPORTANTE:** Essa chave dá acesso TOTAL ao banco. Ela já está no `.gitignore` — **nunca** mande ela pro GitHub, nunca cole em chat/email. Se vazar, gere uma nova no mesmo lugar (a antiga pode ser revogada lá).

---

## 2. Rodar o backup manualmente

```powershell
cd C:\Users\073712631\Desktop\app-geh\dev-tools\backup
npm run backup
```

Saída esperada:

```
Backup do Firestore -> Excel
Projeto: app-geh-cc577
  ajustes_saldo ... 12 docs
  clientes ... 234 docs
  ...
Salvo: ...\backups\backup-2026-05-09_1645.xlsx
Concluido em 4.2s.
```

O `.xlsx` fica em `dev-tools/backup/backups/`. Abra com Excel/LibreOffice — uma aba por coleção, mais uma aba `_resumo` com a contagem.

---

## 3. Agendar pra rodar sozinho (Windows)

Use o **Agendador de Tarefas** (Task Scheduler) do Windows.

1. Aperte `Win + R`, digite `taskschd.msc`, Enter.
2. No painel da direita, **"Criar Tarefa..."** (não "Tarefa Básica").
3. Aba **Geral**:
   - Nome: `Backup Firestore App GEH`
   - Marque **"Executar estando o usuário conectado ou não"**.
   - Marque **"Executar com privilégios mais altos"**.
4. Aba **Disparadores** -> **Novo**:
   - Programar: **Diariamente**, horário ex.: `02:00`.
   - OK.
5. Aba **Ações** -> **Nova**:
   - Ação: **Iniciar um programa**.
   - Programa/script: `node`
   - Adicione argumentos: `backup.js`
   - Iniciar em (sem aspas): `C:\Users\073712631\Desktop\app-geh\dev-tools\backup`
   - OK.
6. Aba **Condições**:
   - Desmarque "Iniciar a tarefa somente se o computador estiver ocioso".
   - Marque "Ativar a tarefa somente se a conexão de rede a seguir estiver disponível" -> "Qualquer conexão" (precisa de internet pra ler o Firestore).
7. Aba **Configurações**:
   - Marque "Executar a tarefa o mais cedo possível depois que um agendamento programado for perdido" (caso o PC esteja desligado no horário).
8. OK -> ele vai pedir sua senha do Windows.

Pra testar agora: clique com o direito na tarefa criada -> **Executar**. Veja se aparece um `.xlsx` novo em `backups/`.

---

## 4. Quantos backups são guardados?

Por padrão, mantém os **últimos 30** (os mais antigos vão sendo apagados automaticamente quando um novo é gerado). Pra mudar, edite `MANTER_ULTIMOS` no topo de `backup.js`. Coloque `0` pra guardar todos.

---

## 5. Restaurar a partir do .xlsx (em caso de emergência)

O `.xlsx` é só pra **leitura humana** em emergência (consultar dados quando o sistema estiver fora do ar). Restaurar de volta pro Firestore em massa **não** está coberto por esse script — se precisar, me chame e a gente faz um script de import.

Pra emergências leves (ver saldo de um cliente, lista de convites antecipados, etc.), a planilha já resolve.

---

## 6. Como o script lida com tipos do Firestore

| Tipo no Firestore        | Vira no Excel                              |
| ------------------------ | ------------------------------------------ |
| Timestamp                | string ISO (`2026-05-09T16:45:00.000Z`)    |
| Number / String / Bool   | direto                                     |
| Array / Object aninhado  | JSON em uma única célula (`{"a":1}`)       |
| GeoPoint                 | `lat,lng`                                  |
| DocumentReference        | `ref:caminho/do/doc`                       |
| null / undefined         | célula vazia                               |

Coleções vazias geram uma aba só com a frase "(coleção vazia)" — pra você ver que ela foi checada.
