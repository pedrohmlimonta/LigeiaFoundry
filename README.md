# Ligeia RPG — Sistema para Foundry VTT V13 e V14

Sistema **não-oficial** para o RPG de mesa **Ligeia**. Fichas de personagem,
habilidades, magias, equipamentos e traços — tudo em português, com as
mecânicas do livro e **compendia prontas** com o conteúdo do Livro de Regras.

---

## Instalação

### Manual

1. Localize a pasta de dados do seu Foundry (`Data/systems/`).
2. Extraia o conteúdo deste pacote para dentro dela, de modo que o caminho
   final fique assim:
   ```
   Data/systems/ligeia-rpg/system.json
   Data/systems/ligeia-rpg/module/...
   Data/systems/ligeia-rpg/templates/...
   ```
   (o `system.json` deve estar em `Data/systems/ligeia-rpg/`, não dentro de
   uma subpasta extra).
3. Reinicie o Foundry. Em **Game Systems**, "Ligeia RPG" deve aparecer.
4. Crie um Mundo usando o sistema **Ligeia RPG**.

### Atualizar de uma versão anterior

Substitua a pasta `Data/systems/ligeia-rpg/` inteira pelo novo conteúdo e
reinicie o Foundry.

---

## O que o sistema inclui

### Fichas
- **Personagem** e **NPC** (ApplicationV2), com:
  - Cabeçalho com retrato, nome, conceito e linha de identidade
    (raça, herança, vocação, carreiras, nação, organizações, nível).
  - **Atributos primários** (Força, Agilidade, Vigor, Mente, Percepção) em
    círculos clicáveis que **rolam 2d6 + atributo + dados de melhoria**.
  - **Atributos secundários** derivados automaticamente (Bloqueio, Esquiva,
    Conjuração, Iniciativa, Deslocamento, Carga…).
  - **Recursos**: PV, PM e Pontos Heroicos com máximos calculados.
  - Seções de **Habilidades, Magias, Equipamentos e Traços** com
    arrastar-e-soltar.
  - **Personalidade & Notas** (editor de texto rico).

### Tipos de Item
- **Habilidade** — níveis Básico/Avançado/Especial, pré-requisito, listas,
  ativação e slots (alvo/área/alcance/duração), descrições por nível.
- **Magia** — palavra arcana, círculo (Menor/Intermediária/Maior),
  conjuração, slots, descrição, peculiaridades e **metamagias**.
- **Equipamento** — categoria, peso, preço, notas; opção de **arma** que
  gera ataque derivado.
- **Traço** — origem (racial/herança/…), descrição; opção de ataque.
- **Definições**: **Raça, Herança, Vocação, Organização** — cada uma carrega
  uma **lista de habilidades** concedidas.

### Sistema de efeitos (passivo / ativo)
Cada Item pode conceder **efeitos mecânicos** quando ativo:
- `dice` (+dados de melhoria), `bonus` (+resultado), `stat` (modifica valor
  derivado), `set` (define valor fixo), `damage`, `rd` (redução de dano),
  `autocrit` (crítico garantido na rolagem escolhida), `immune` (imunidade a
  tipo de dano, condição, circunstância ou item) e `info` (condição textual).
- O alvo de cada efeito pode ser um atributo, uma categoria de rolagem
  (ataque e defesa separados por corpo a corpo, distância e magia), uma
  tipagem de arma, uma palavra arcana, **resistir a uma condição** ou
  **outro item da ficha** (vale em todas as ações daquele item).
- **Passivo**: sempre ativo. **Ativo**: o jogador liga/desliga quando precisar.
- Cada efeito pode ser ligado/desligado individualmente.
- **Custos** de recurso (PM, PV, PV temporário, Heroico) por ativação/uso.

### Listas de acesso e custo de XP
- Raça/Herança/Vocação/Organização concedem listas de habilidades.
- Habilidade **na lista** do personagem = custo de XP normal; **fora da
  lista** = custo **dobrado (×2)**.
- Painel de XP (gasto × disponível) e etiqueta de custo por habilidade.

### Economia de ações (opcional)
Desligada por padrão; liga-se em **Configurações → Opções do Sistema →
"Economia de ações"**. Com ela:
- Cada personagem tem por rodada **1 ação padrão, 1 de movimento, 1 simples,
  1 reação** e **ações livres à vontade**, tudo recuperado no **início do
  seu turno**.
- Cada ação de item e cada ativação de item pode **gastar** uma delas.
- Efeitos do tipo *Ações por rodada* **dão** (+1 simples) ou **tiram**
  (−1 movimento) ações enquanto estiverem ativos, e podem liberar a
  **corrida**.
- **Deslocamento**, nas mesmas cores do medidor do token: até o
  deslocamento (**verde**) custa a ação de movimento — ou a **padrão**, se a
  de movimento já tiver saído ou não existir, de modo que quem não tem como
  se mover ainda anda usando a ação principal. Passar do deslocamento
  (**amarelo**) cobra também a padrão: é o duplo deslocamento. Um efeito de
  **corrida** dispensa essa segunda cobrança. O que vale é o **acumulado do
  turno** — andar 5m e depois mais 6m com 9m de deslocamento cobra a de
  movimento no primeiro trecho e a padrão no segundo, não o preço inteiro
  duas vezes. Só é cobrado em combate, no turno de quem se move.
- **Condições limitam ações**: Atordoado, Inconsciente e Paralisado tiram as
  ações do turno; Imobilizado (e Agarrado) tira a de movimento; Pasmo (e
  Dominado) deixa só **uma ação por turno**. A tabela vive em
  `CONFIG.LIGEIA.conditionActions` e pode ser reescrita pela mesa.
- **Sustentação**: tudo o que precisa de ação para continuar de pé — um item
  ligado, uma área, uma aura, uma criatura conjurada, um efeito posto em
  alguém — deixa um **vínculo** na lista de Efeitos & Condições de quem
  sustenta. O vínculo cobra a ação **a cada turno**; sem a ação, ele cai e
  leva a coisa junto (a área sai do mapa, a criatura some da cena **e da
  iniciativa**, o item se desliga, o efeito sai da ficha de quem o recebeu).
  Para largar antes, basta desligar ou remover o vínculo — não há aba de
  concentração: o que o personagem está segurando está nos efeitos dele.

### Conjuração
Arraste para a ação as fichas (personagem, NPC ou veículo) que ela pode
invocar — a lista é um **cardápio**. Ao clicar no botão da ação, uma caixa
pergunta **qual** criatura conjurar (com uma só no cardápio, ela sai
direto). Sai **uma** por ativação: três lobos, nunca um lobo e um urso
juntos. A quantidade é fixa e vem do **número geral** da ação ou do número
próprio da criatura, conforme a caixinha "geral" da linha dela. Depois você
escolhe no mapa onde cada cópia aparece, dentro do alcance da ação, e, sendo
sustentável, **todas as cópias entram num vínculo só**.

Cada criatura conjurada ganha uma **ficha própria** em Atores, na pasta
*Conjurados* — três lobos são três fichas, com PV, condições e efeitos
independentes, sem um lobo ferido arrastar os outros. Quem conjurou recebe a
posse dela. A ficha é apagada quando a criatura é **dispensada** (o vínculo
foi solto, a ação faltou) ou quando ela **morre**; morrendo uma de três, as
outras duas continuam e o vínculo encolhe. Desmarcando "ficha própria", o
token é avulso e nenhuma ficha é criada.

### Emanações
Uma ação de área ou aura pode deixar a área no mapa e reaplicar-se a quem
iniciar o turno dentro dela. Além disso, um **efeito do tipo Emanação** cria
uma aura em volta de quem o carrega: o valor do efeito é o raio, e o texto ao
lado nomeia a ação que a aura dispara a cada turno (vazio = só o círculo). A
aura nasce quando o efeito fica ativo e some quando ele sai.

### Caixa de rolagem
Antes de cada rolagem abre uma caixa para ajustar bônus, dados de melhoria e
a CD (ou o atributo de defesa do alvo). Com a economia de ações ligada, ela
mostra também **qual ação aquele uso gasta**, com o que resta de cada tipo, e
deixa trocar na hora — a troca vale só para aquele uso. Fichas **novas**
nascem com "sem caixa" ligado; quem quiser a caixa desmarca na ficha.

### Rolagem 2d6 fiel ao livro
- 2d6 + atributo + dados de melhoria; entram na soma os **2 maiores** dados.
- **Sucesso crítico**: os dois dados que entram são ambos **6**.
- **Falha crítica**: os dois dados que entram são ambos **1**.
- Níveis de dificuldade do livro (Muito Fácil 6 … Épica 17).
- Iniciativa do combate usa `2d6 + iniciativa`.

---

## Conteúdo (Livro de Regras)

Os compêndios de conteúdo (habilidades, magias, traços e equipamentos do
Livro de Regras) **não fazem parte deste sistema**. Eles serão distribuídos
em um **módulo separado**, instalável à parte. Assim o sistema fica enxuto e
o conteúdo pode ser atualizado de forma independente.

Enquanto o módulo não estiver disponível, você pode criar itens manualmente
pelas fichas — todos os tipos (habilidade, magia, traço, equipamento, raça,
herança, vocação, carreira, organização) estão disponíveis na barra lateral
de Itens.

---

## Notas técnicas
- Foundry **V13 e V14** (compatibilidade declarada até a geração 14).
- **Nota V14:** o Foundry V14 removeu os *Measured Templates*. Enquanto a
  área/aura visual não é reescrita para *Template Regions*, no V14 as ações de
  área/aura ainda funcionam (afetam os alvos), porém sem o círculo visual, e a
  emanação persistente fica desativada. No V13 tudo funciona normalmente.
- DataModels (`foundry.abstract.TypeDataModel`) para Ator e Item.
- Sheets em **ApplicationV2** (`foundry.applications.*`).
- Interface **somente em português (pt-BR)**.

Sistema não-oficial, feito pela comunidade, sem vínculo com os autores de
Ligeia.
