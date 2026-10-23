---
updatedAt: 2026-03-02T20:42:00.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Critérios de homologação

Critérios para homologar a integração

Este processo tem como objetivo estabelecer os critérios necessários para a homologação da integração com a API de Pedidos. A etapa de homologação é fundamental para garantir que a integração esteja funcionando de forma correta, segura e aderente às regras de negócio definidas.

Durante esse processo, serão validados os fluxos essenciais da operação de pedidos, incluindo criação, confirmação, cancelamento, atualizações de status e demais eventos previstos na documentação da API. O objetivo é assegurar que todas as requisições e respostas estejam em conformidade com os padrões técnicos e funcionais estabelecidos.

O cumprimento dos critérios descritos é indispensável para a aprovação da integração e posterior liberação para o ambiente de produção.

### Critérios

#### Módulo Delivery

* Enviar um pedido de delivery com entrega pelo parceiro (mode: DELIVERY / delivery\_by: PARTNER)
* Enviar um pedido de delivery com entrega pela loja (mode: DELIVERY / delivery\_by: RESTAURANT)
* Enviar um pedido agendado. É necessário exibir a data e hora do agendamento nas observações do pedido. (scheduled: true / delivery\_date\_time: 2020-10-08T01:25:49
* Enviar um pedido com o mesmo order\_id
* Enviar um pedido com caracteres especiais nas informações do Estado e Cidade do endereço do cliente
* Enviar um pedido sem o telefone do cliente
* Enviar dois pedidos com o mesmo ID de cliente
* Enviar um pedido com o consumidor não identificado (customer.id:  -1)
* Enviar um pedido com código PDV correto de um produto/complemento
* Enviar um pedido com mais de uma forma de pagamento
* Enviar um pedido com uma forma de pagamento online (code: PARTNER\_PAYMENT/ type: ONLINE)
* Enviar um pedido com uma forma de pagamento offline
* Enviar um pedido com pagamento em cartão e exibir detalhes do tipo de pagamento, como bandeira (code: CRE / complement: VISA)
* Enviar um pedido com pagamento em pix realizado no parceiro (code: PARTNER\_PAYMENT/ complement: PIX / type: ONLINE)
* Enviar um pedido com pagamento em dinheiro e exibir o valor do troco (code: DIN / change\_for: 5 )
* Enviar um pedido com observações dos itens e exibir na tela de detalhes do pedido  (notes: sem cebola)
* Enviar um pedido com observações do pedido e exibir na tela de detalhes do pedido  (notes: entregar na rua 43)
* Enviar um pedido com descontos (total\_discount :10)
* Enviar um pedido com acréscimo (total\_increase: 10)
* Enviar um pedido com entrega pelo parceiro com taxa de entrega (delivery\_fee:1)
* Enviar um pedido com entrega pela loja sem taxa de entrega (delivery\_fee:0)
* Atualizar o status de um pedido cancelado pelo parceiro, caso for pedido com entrega pelo parceiro (delivery\_by: PARTNER)
* Atualizar o status de um pedido em entrega/saiu para entrega pelo parceiro, caso for pedido com entrega pelo parceiro (delivery\_by: PARTNER)
* Atualizar o status de um pedido entregue pelo parceiro, caso for pedido com entrega pelo parceiro (delivery\_by: PARTNER)

#### Módulo Ficha

* Enviar dois pedidos com o mesmo ID de cliente
* Enviar um pedido com o mesmo order\_id
* Enviar um pedido com o consumidor não identificado (customer.id:  -1)
* Enviar um pedido com código PDV correto de um produto/complemento
* Enviar um pedido com mais de uma forma de pagamento
* Enviar um pedido com uma forma de pagamento online (code: PARTNER\_PAYMENT/ type: ONLINE)
* Enviar um pedido com uma forma de pagamento offline
* Enviar um pedido com pagamento em cartão e exibir detalhes do tipo de pagamento, como bandeira (code: CRE / complement: VISA)
* Enviar um pedido com pagamento em pix realizado no parceiro (code: PARTNER\_PAYMENT/ complement: PIX / type: ONLINE)
* Enviar um pedido com pagamento em dinheiro e exibir o valor do troco (code: DIN / change\_for: 5 )
* Enviar um pedido com observações dos itens e exibir na tela de detalhes do pedido  (notes: sem cebola)
* Enviar um pedido com observações do pedido e exibir na tela de detalhes do pedido  (notes: entregar na rua 43)
* Enviar um pedido com descontos (total\_discount :10)
* Enviar um pedido com acréscimo (total\_increase: 10)

#### Módulo Mesa

* Enviar dois pedidos com o mesmo ID de cliente
* Enviar um pedido com o mesmo order\_id
* Enviar um pedido com código PDV correto de um produto/complemento
* Enviar um pedido com observações dos itens e exibir na tela  (notes: sem cebola)
* Enviar um pedido com observações do pedido e exibir na tela  (notes: entregar na rua 43)
* Enviar mais itens a um pedido de mesa já existente
* Enviar um pedido com um nome de mesa não existente
* Solicitar um fechamento de mesa
* Enviar um pedido ou novo item para uma mesa solicitada o fechamento
* Transferir um pedido para outra mesa aberta
* Vincular um garçom em uma mesa

#### Módulo Mesa com Comanda

* Enviar dois pedidos com o mesmo ID de cliente
* Enviar um pedido com o mesmo order\_id
* Enviar um pedido para uma comanda com desc\_order\_pad não existente
* Enviar um pedido com código PDV correto de um produto/complemento
* Enviar um pedido com observações dos itens e exibir na tela  (notes: sem cebola)
* Enviar um pedido com observações do pedido e exibir na tela  (notes: entregar na rua 43)
* Enviar mais itens a um pedido de mesa já existente
* Enviar um pedido com um nome de mesa não existente
* Enviar mais itens a um pedido de comanda já existente
* Enviar um novo pedido para uma comanda aberta
* Solicitar um fechamento de mesa
* Adicionar múltiplas comandas em uma mesa
* Enviar um novo item para uma mesa solicitada o fechamento
* Enviar um novo item para uma comanda solicitada o fechamento
* Transferir um pedido para outra mesa aberta
* Vincular um garçom em uma mesa

#### Módulo Takeout/Balcão

* Enviar um pedido agendado. É necessário exibir a data e hora do agendamento nas observações do pedido. (scheduled: true / delivery\_date\_time: 2020-10-08T01:25:49
* Enviar um pedido com o mesmo order\_id
* Enviar dois pedidos com o mesmo ID de cliente
* Enviar um pedido com o consumidor não identificado (customer.id:  -1)
* Enviar um pedido com código PDV correto de um produto/complemento
* Enviar um pedido com mais de uma forma de pagamento
* Enviar um pedido com uma forma de pagamento online (code: PARTNER\_PAYMENT/ type: ONLINE)
* Enviar um pedido com uma forma de pagamento offline
* Enviar um pedido com pagamento em cartão e exibir detalhes do tipo de pagamento, como bandeira (code: CRE / complement: VISA)
* Enviar um pedido com pagamento em pix realizado no parceiro (code: PARTNER\_PAYMENT/ complement: PIX / type: ONLINE)
* Enviar um pedido com pagamento em dinheiro e exibir o valor do troco (code: DIN / change\_for: 5 )
* Enviar um pedido com observações dos itens exibir na tela de detalhes do pedido  (notes: sem cebola)
* Enviar um pedido com observações do pedido exibir na tela de detalhes do pedido  (notes: entregar na rua 43)
* Enviar um pedido com descontos (total\_discount :10)
* Enviar um pedido com acréscimo (total\_increase: 10)

<br />