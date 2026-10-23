---
updatedAt: 2026-04-08T14:52:15.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Guia prático de integração

De forma simples e objetiva, mostramos passo a passo como utilizar a API de Pedidos na Saipos

## Credenciamento

1. No <Anchor label="Saipos Developer" target="_blank" href="https://developer.saipos.com/">Saipos Developer</Anchor>, realize o cadastro para que possa estar acessando a nossa plataforma e obtendo as suas credenciais para dar início ao seu desenvolvimento

<Image align="center" border={true} caption="Saipos Developer - Cadastro de novo parceiro" src="https://files.readme.io/0a282de3feae9ab2693cf90f3e4949fde729a6ed44a01f983c51835945fd158b-saipos_developer_cadastro.png" />

2. Ao finalizar o preenchimento do formulário, realize o login com o usuário e senha informados no cadastro e após, terá acesso as suas configurações das APIs.
3. Nela conterá 3 abas contendo:
   1. **Credenciais**:
      1. A chave pública (Secret)
      2. Dados da loja de teste para utilizar em seu desenvolvimento, contendo: ID da Loja, URL de acesso, Usuário, IDPartner e a opção de redefinir senha.
         1. O usuário criado no Saipos Developer, é o mesmo utilizado para acessar a loja de testes, ou seja, caso houver redifinicação de senha, a alteração impactará tanto no Saipos Developer quanto na loja de testes.
   2. **Configuração**
      1. Nome do canal que será exibido para as lojas que utilizarem a integração
      2. Módulos de Integrações que serão desenvolvidas e assim, após homologadas.
      3. Configuração de Webhook para receber os eventos
   3. **Identidade Visual**
      1. Adicionar a logo do parceiro para que seja exibido na Conta Saipos.

<Image align="center" border={true} caption="Saipos Developer - Credenciais" src="https://files.readme.io/82f06b6399cdd201890e8a137e82c0f321a1ceb66b49a20805e0294ed3058830-image.png" />

<Image align="center" border={true} caption="Saipos Developer - Configuração" src="https://files.readme.io/e716c6d1b8dfb1d2e39d5b2f7a323b9ce65f98e6e84d59a8b417a7df37f94751-image.png" />

<Image align="center" border={true} caption="Saipos Developer - Identidade visual" src="https://files.readme.io/f0c8550843c48ccbe0a007f5058060a38209cd5d066b074a7a0e3ff75724facf-image.png" />

## Homologação

Para cada API e/ou módulo da API, é necessário passar pelo processo de homologação.

A solicitação deve ser realizada pelo caminho indicado no início desta documentação. Após isso, você receberá uma planilha com os critérios de validação (os mesmos descritos na seção de [Critérios de Homologação](https://saipos-docs-order-api.readme.io/reference/criterios-de-homologacao)).

Caso a validação seja concluída com sucesso, a sua integração será liberada em produção, permitindo que as lojas possam utilizá-la.

## Ativação da integração na loja

1. Na Conta Saipos, dentro do **Menu>Canais de Vendas e Integrações**, busque a sua integração e clique em **Configurar**

<Image align="center" border={true} caption="Menu Canais de Vendas e Integrações" src="https://files.readme.io/9e17b4d76921c6242e8354e2f50cdad8f274b35764470a22ff56676b1c616f0d-image.png" />

2. Siga os seguintes passos:
   1. Clique em **"Confirmar pedidos automaticamente"** para que os pedidos sejam confirmados de forma automática ao integrar na Saipos
   2. Clique em **"Adicionar novo código de loja"** para adicionar o **ID da loja no Parceiro e o Nome** que será exibido
   3. Clique em **"Habilitar integração"** para concluir a inserção da informação
   4. Clique em **"Adicionar formas de pagamento padrão"** para inserir as formas de pagamento que serão correlacionadas com as formas de pagamento cadastradas.
   5. Clique em **"Salvar"** para assim, após o salvamento, gerar o **IDPartner**

<Image align="center" border={true} caption="Configurações da Integração" src="https://files.readme.io/36da01431d9a443f185a85aa5aed4cd9dca2a67c968012053eaa93771c7b3a48-canais_de_vendas.png" />

<br />