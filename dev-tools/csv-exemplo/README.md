# CSVs de exemplo pra teste de uso

Arquivos pra colar nos campos "Importar em lote" da plataforma e popular o evento de teste rapidinho.

## Como usar

Cada CSV é colado direto no `<textarea>` da tela correspondente — abre o arquivo num editor de texto, copia tudo (Ctrl+A, Ctrl+C) e cola na plataforma.

| Arquivo | Tela | Formato |
|---|---|---|
| `produtos-exemplo.csv` | Admin → Produtos | `Nome, Preço, Estoque, Categoria` |
| `clientes-exemplo.csv` | Admin → Clientes | um ID por linha |
| `despesas-exemplo.csv` | Admin → Despesas | `Data, Descrição, Valor, Categoria, Forma, Tipo, Responsável, Insumo` |

## Ordem sugerida

1. **Produtos** primeiro — pra ter o que vender no operador.
2. **Clientes** — pra ter QRs simulados (use IDs `TESTE001..TESTE030` pra distinguir de cliente real).
3. **Despesas** — pra ter dados no fechamento e relatório.
4. (Opcional) Adicionar saldo manual em alguns clientes via Admin → Ajuste de Saldo, simulando recargas pré-evento.

## Categorias de ingresso

Não tem importação em lote — precisa cadastrar manualmente em Admin → Eventos. Sugestão pro evento de teste:

| Nome | Antecipado | Porta | Estoque porta |
|---|---|---|---|
| Adulto | 30,00 | 50,00 | 30 |
| Criança (até 12 anos) | 15,00 | 25,00 | 20 |
| Idoso (60+) | 15,00 | 25,00 | 15 |

## Limpar depois

Os clientes têm prefixo `TESTE` justamente pra ficar fácil identificar e apagar depois pelo filtro de busca em Admin → Clientes.
