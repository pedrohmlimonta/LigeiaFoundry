# Como publicar e instalar o Ligeia RPG via manifesto

## Visão geral
A instalação por manifesto no Foundry usa **GitHub Releases**. Cada release
expõe dois arquivos: `system.json` e `ligeia-rpg.zip`. Uma GitHub Action
(`.github/workflows/release.yml`) gera e anexa esses arquivos automaticamente.

## 1. Subir o projeto para o GitHub (uma vez)
```bash
cd ligeia-foundry
git init
git add .
git commit -m "Sistema Ligeia RPG para Foundry V13"
git branch -M main
git remote add origin https://github.com/pedrohmlimonta/ligeia-foundry.git
git push -u origin main
```
> Importante: o repositório precisa se chamar **ligeia-foundry** e o usuário
> **pedrohmlimonta** (são os valores nas URLs do system.json). Se forem
> outros, edite `url`, `manifest` e `download` no system.json antes.

## 2. Publicar uma versão (a cada atualização)
1. No GitHub, vá em **Releases → Draft a new release**.
2. Em **Choose a tag**, digite a versão no formato `v0.1.0` (com o "v") e
   clique em "Create new tag on publish".
3. Dê um título (ex.: "0.1.0") e clique em **Publish release**.
4. A Action roda sozinha, ajusta a versão no system.json conforme a tag e
   anexa `system.json` + `ligeia-rpg.zip` à release.

> A tag DEVE ser `vX.Y.Z`. A Action usa o número da tag como versão.
> Para lançar a próxima, crie `v0.2.0`, `v1.0.0`, etc.

## 3. Instalar no Foundry (qualquer instância)
1. Foundry → **Game Systems → Install System**.
2. No campo **Manifest URL**, cole:
   ```
   https://github.com/pedrohmlimonta/ligeia-foundry/releases/latest/download/system.json
   ```
3. Clique em **Install**. O Foundry baixa o zip da release e instala.
4. Crie um Mundo usando o sistema **Ligeia RPG**.

Como o manifest aponta para `releases/latest`, atualizações futuras aparecem
automaticamente no Foundry (botão "Update").

## Instalação manual (alternativa, sem release)
Baixe o `ligeia-rpg.zip` e extraia em `Data/systems/ligeia-rpg/` de modo que o
`system.json` fique direto nessa pasta. Reinicie o Foundry.

## Notas
- As compendia (packs LevelDB) já vão versionadas no repositório.
- Se um dia quiser regenerá-las no release a partir das bibliotecas, mantenha
  um `build-packs.mjs` e descomente o bloco "Gerar compendia" no workflow.
