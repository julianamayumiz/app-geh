/**
 * Script Google Apps Script — Cria formulario de feedback pos-evento do App GEH
 *
 * Como usar:
 *   1. Acesse script.google.com e crie um novo projeto
 *   2. Cole todo o conteudo deste arquivo
 *   3. Clique em Executar > criarFormularioFeedback
 *   4. Autorize as permissoes quando solicitado
 *   5. Veja o link do formulario no log (Ver > Registros)
 *
 * Estrutura do formulario:
 *   Secao 1 (todos)    — Identificacao + papel → navega para secao do papel
 *   Secao 2 (Operador) — Perguntas de venda
 *   Secao 3 (Caixa)    — Perguntas de recarga
 *   Secao 4 (Recepcao) — Perguntas de check-in
 *   Secao 5 (todos)    — Experiencia geral + NPS
 */
function criarFormularioFeedback() {
  var form = FormApp.create('Feedback de Uso — App GEH');

  form.setDescription(
    'Formulario pos-evento para quem usou o App GEH.\n' +
    'Suas respostas nos ajudam a melhorar para os proximos eventos!'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('Obrigado pelo feedback! Isso nos ajuda muito a melhorar o app.');

  // =========================================================
  // SECAO 1 — Identificacao (pagina inicial, sem page break)
  // =========================================================

  form.addSectionHeaderItem()
    .setTitle('Identificacao')
    .setHelpText('Rapido — so pra entender o contexto das suas respostas.');

  form.addTextItem()
    .setTitle('Qual foi o evento?')
    .setHelpText('Ex: Rodeio 2025, Acampamento Junho...')
    .setRequired(true);

  var qPapel = form.addMultipleChoiceItem()
    .setTitle('Qual foi o seu papel no evento?')
    .setRequired(true);
  // choices sao configuradas depois, quando as secoes ja existem

  // =========================================================
  // SECAO 2 — Operador
  // =========================================================

  var secOperador = form.addPageBreakItem()
    .setTitle('Perguntas — Operador')
    .setHelpText('Sobre as vendas que voce registrou durante o evento.');

  form.addMultipleChoiceItem()
    .setTitle('As vendas foram registradas corretamente no app?')
    .setChoiceValues([
      'Sim, sem nenhum problema',
      'A maioria sim, tive alguns problemas pontuais',
      'Tive bastante dificuldade'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Conseguiu localizar os produtos com facilidade?')
    .setChoiceValues(['Sim', 'Mais ou menos', 'Nao, foi dificil'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('O app ficou lento ou travou durante as vendas?')
    .setChoiceValues([
      'Nao, funcionou bem o tempo todo',
      'Ficou lento algumas vezes, mas nao atrapalhou',
      'Travou bastante e atrapalhou o atendimento'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('O saldo do cliente era exibido com clareza antes de confirmar a venda?')
    .setChoiceValues(['Sim, bem visivel', 'Mais ou menos', 'Nao conseguia ver bem'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('Teve algum problema especifico nas vendas? Descreva:')
    .setHelpText('Opcional — deixe em branco se nao houve problemas.');

  // =========================================================
  // SECAO 3 — Caixa
  // =========================================================

  var secCaixa = form.addPageBreakItem()
    .setTitle('Perguntas — Caixa')
    .setHelpText('Sobre as recargas de saldo que voce processou.');

  form.addMultipleChoiceItem()
    .setTitle('As recargas de saldo foram processadas corretamente?')
    .setChoiceValues([
      'Sim, sem nenhum problema',
      'A maioria sim, tive alguns problemas pontuais',
      'Tive bastante dificuldade'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Conseguiu localizar o cliente pelo nome ou codigo com facilidade?')
    .setChoiceValues(['Sim', 'Mais ou menos', 'Nao, foi dificil'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('O saldo atualizado aparecia corretamente apos a recarga?')
    .setChoiceValues(['Sim', 'Algumas vezes demorou a atualizar', 'Nao, nao aparecia'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('O historico de movimentacoes estava acessivel quando precisou?')
    .setChoiceValues([
      'Sim, sem problemas',
      'Nao precisei consultar',
      'Tentei acessar mas tive dificuldade'
    ])
    .setRequired(true);

  form.addTextItem()
    .setTitle('Teve algum problema especifico nas recargas? Descreva:')
    .setHelpText('Opcional.');

  // =========================================================
  // SECAO 4 — Recepcao
  // =========================================================

  var secRecepcao = form.addPageBreakItem()
    .setTitle('Perguntas — Recepcao')
    .setHelpText('Sobre o check-in e as vendas na porta.');

  form.addMultipleChoiceItem()
    .setTitle('O check-in dos participantes funcionou bem?')
    .setChoiceValues([
      'Sim, sem nenhum problema',
      'Tive alguns problemas pontuais',
      'Nao funcionou bem'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('A lista de convidados estava completa e atualizada?')
    .setChoiceValues([
      'Sim, estava completa',
      'Faltavam alguns nomes',
      'Estava bastante desatualizada'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Conseguia confirmar presenca rapidamente sem travar a fila?')
    .setChoiceValues(['Sim, foi rapido', 'Mais ou menos', 'Ficou lento e gerou fila'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('As vendas na porta foram registradas sem problema?')
    .setChoiceValues([
      'Sim, sem problemas',
      'Tive alguns problemas',
      'Nao usei essa funcao'
    ])
    .setRequired(true);

  form.addTextItem()
    .setTitle('Teve algum problema especifico na recepcao? Descreva:')
    .setHelpText('Opcional.');

  // =========================================================
  // SECAO 5 — Experiencia Geral (todos convergem aqui)
  // =========================================================

  var secGeral = form.addPageBreakItem()
    .setTitle('Experiencia Geral')
    .setHelpText('Ultimas perguntas — valem para todos os papeis.');

  form.addScaleItem()
    .setTitle('De 1 a 5, como voce avalia sua experiencia geral com o app?')
    .setBounds(1, 5)
    .setLabels('Pessima', 'Excelente')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Voce conseguiu usar o app sem precisar de ajuda de outra pessoa?')
    .setChoiceValues([
      'Sim, sem dificuldade',
      'Precisei de um pouco de ajuda no inicio',
      'Precisei de bastante ajuda'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('O app foi facil de navegar no celular?')
    .setChoiceValues(['Sim, muito intuitivo', 'Mais ou menos', 'Nao, foi confuso'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('As informacoes na tela eram claras (valores, botoes, mensagens de erro)?')
    .setChoiceValues([
      'Sim, muito claras',
      'Algumas coisas eram confusas',
      'Nao, foi bem confuso'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Comparado a como era antes (papel / outro sistema), o app foi...')
    .setChoiceValues([
      'Muito melhor',
      'Um pouco melhor',
      'Igual',
      'Um pouco pior',
      'Muito pior',
      'Nao tenho comparacao (primeira vez)'
    ])
    .setRequired(true);

  form.addTextItem()
    .setTitle('O que voce mais gostou no app?')
    .setHelpText('Opcional, mas adoramos saber!');

  form.addTextItem()
    .setTitle('O que te incomodou ou voce mudaria?')
    .setHelpText('Opcional.');

  form.addTextItem()
    .setTitle('Tem algo que falta no app e faria diferenca no proximo evento?')
    .setHelpText('Opcional.');

  form.addScaleItem()
    .setTitle('De 0 a 10, o quanto voce recomendaria esse app para outra equipe de evento usar?')
    .setBounds(0, 10)
    .setLabels('Nao recomendaria', 'Recomendaria com certeza')
    .setRequired(true);

  // =========================================================
  // Navegacao por papel — configurar apos criar todas as secoes
  // =========================================================

  // Secoes especificas navegam para Geral ao terminar
  secOperador.setGoToPage(secGeral);
  secCaixa.setGoToPage(secGeral);
  secRecepcao.setGoToPage(secGeral);

  // Pergunta de papel: cada opcao navega para a secao correta
  qPapel.setChoices([
    qPapel.createChoice('Operador (registrei vendas)', secOperador),
    qPapel.createChoice('Caixa (fiz recargas de saldo)', secCaixa),
    qPapel.createChoice('Recepcao (fiz check-in / vendas na porta)', secRecepcao),
    qPapel.createChoice('Admin / Diretoria', FormApp.PageNavigationType.SUBMIT)
  ]);

  // Ajusta Admin para ir direto para secao geral
  qPapel.setChoices([
    qPapel.createChoice('Operador (registrei vendas)', secOperador),
    qPapel.createChoice('Caixa (fiz recargas de saldo)', secCaixa),
    qPapel.createChoice('Recepcao (fiz check-in / vendas na porta)', secRecepcao),
    qPapel.createChoice('Admin / Diretoria', secGeral)
  ]);

  // =========================================================
  // Log dos links
  // =========================================================

  Logger.log('=== Formulario criado com sucesso! ===');
  Logger.log('Link para editar: ' + form.getEditUrl());
  Logger.log('Link para responder (compartilhe esse): ' + form.getPublishedUrl());
}
