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
  derivado), `set` (define valor fixo), `damage`, `rd` (redução de dano) e
  `info` (condição textual).
- **Passivo**: sempre ativo. **Ativo**: o jogador liga/desliga quando precisar.
- Cada efeito pode ser ligado/desligado individualmente.
- **Custos** de recurso (PM, PV, PV temporário, Heroico) por ativação/uso.

### Listas de acesso e custo de XP
- Raça/Herança/Vocação/Organização concedem listas de habilidades.
- Habilidade **na lista** do personagem = custo de XP normal; **fora da
  lista** = custo **dobrado (×2)**.
- Painel de XP (gasto × disponível) e etiqueta de custo por habilidade.

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
