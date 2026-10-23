---
updatedAt: 2026-08-05T18:07:51.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Estrutura de campos por endpoint

Detalhamento dos atributos, layout dos campos e respectivas definições para cada endpoint da API.

## `POST /auth`

| Propriedade | Obrigatório | Tipo   | Descrição                  |
| ----------- | ----------- | ------ | -------------------------- |
| `idPartner` | Sim         | String | ID do parceiro.            |
| `secret`    | Sim         | String | Chave secreta do parceiro. |

## `POST /cancel-order`

| Propriedade | Obrigatório | Tipo   | Descrição       |
| ----------- | ----------- | ------ | --------------- |
| `order_id`  | Sim         | String | ID do pedido.   |
| `cod_store` | Sim         | String | Código da loja. |

## `POST /update-order-status`

| Propriedade | Obrigatório | Tipo   | Descrição                                                  |
| ----------- | ----------- | ------ | ---------------------------------------------------------- |
| `order_id`  | Sim         | String | ID do pedido.                                              |
| `status`    | Sim         | String | Status do pedido (`CANCELLED`, `DISPATCHED`, `CONCLUDED`). |

## `PUT /close-sale`

| Propriedade | Obrigatório | Tipo   | Descrição       |
| ----------- | ----------- | ------ | --------------- |
| `order_id`  | Sim         | String | ID do pedido.   |
| `cod_store` | Sim         | String | Código da loja. |

## `POST /order` - DELIVERY

| Propriedade                               | Obrigatório | Tipo    | Descrição                                                                         |
| ----------------------------------------- | ----------- | ------- | --------------------------------------------------------------------------------- |
| `order_id`                                | Sim         | String  | ID do pedido.                                                                     |
| `display_id`                              | Sim         | String  | Identificador visível do pedido.                                                  |
| `cod_store`                               | Sim         | String  | Código da loja.                                                                   |
| `created_at`                              | Sim         | String  | Data/hora de criação do pedido.                                                   |
| `notes`                                   | Não         | String  | Observações do pedido.                                                            |
| `total_discount`                          | Sim         | Number  | Valor total de desconto.                                                          |
| `total_increase`                          | Não         | Number  | Valor total de acréscimo.                                                         |
| `otherFees`                               | Não         | Object  | Dados de taxas adicionais que compõem o campo `total_increase`                    |
| `otherFees.description`                   | Não         | String  | Descrição textual da taxa . Exemplo: "Taxa de Serviço" ou "Taxa de pedido mínimo" |
| `otherFees.type`                          | Sim         | String  | Tipo da taxa aplicada (`SERVICE_FEE` ou`MIN_ORDER_FEE`).                          |
| `otherFees.liability`                     | Sim         | String  | Responsável financeiro pela taxa (`PARTNER` ou`RESTAURANT`).                      |
| `otherFees.value`                         | Sim         | Number  | Valor da taxa aplicada                                                            |
| `total_amount`                            | Não         | Number  | Valor total informado pelo parceiro.                                              |
| `customer`                                | Sim         | Object  | Dados do cliente.                                                                 |
| `customer.id`                             | Sim         | String  | ID do cliente.                                                                    |
| `customer.name`                           | Sim         | String  | Nome do cliente.                                                                  |
| `customer.phone`                          | Sim         | String  | Telefone do cliente.                                                              |
| `customer.email`                          | Não         | String  | E-mail do cliente.                                                                |
| `customer.document_number`                | Não         | String  | Documento do cliente.                                                             |
| `customer.localizer`                      | Não         | String  | Localizador externo do cliente.                                                   |
| `order_method`                            | Sim         | Object  | Dados do método do pedido.                                                        |
| `order_method.mode`                       | Sim         | String  | Tipo do pedido (`DELIVERY`).                                                      |
| `order_method.delivery_by`                | Sim         | String  | Responsável pela entrega (`PARTNER` ou `RESTAURANT`).                             |
| `order_method.delivery_fee`               | Sim         | Number  | Taxa de entrega.                                                                  |
| `order_method.scheduled`                  | Sim         | Boolean | Indica se o pedido é agendado.                                                    |
| `order_method.delivery_date_time`         | Não         | String  | Data/hora informada para entrega.                                                 |
| `order_method.pickupCode`                 | Não         | String  | Código de retirada/validação.                                                     |
| `delivery_address`                        | Sim         | Object  | Endereço de entrega.                                                              |
| `delivery_address.country`                | Sim         | String  | País.                                                                             |
| `delivery_address.state`                  | Sim         | String  | Sigla do estado (ex.: `RS`).                                                      |
| `delivery_address.city`                   | Sim         | String  | Cidade.                                                                           |
| `delivery_address.district`               | Sim         | String  | Bairro.                                                                           |
| `delivery_address.street_name`            | Sim         | String  | Rua/logradouro.                                                                   |
| `delivery_address.street_number`          | Sim         | String  | Número.                                                                           |
| `delivery_address.postal_code`            | Sim         | String  | CEP.                                                                              |
| `delivery_address.reference`              | Não         | String  | Referência do endereço.                                                           |
| `delivery_address.complement`             | Não         | String  | Complemento do endereço.                                                          |
| `delivery_address.coordinates`            | Não         | Object  | Coordenadas geográficas.                                                          |
| `delivery_address.coordinates.latitude`   | Não         | Number  | Latitude.                                                                         |
| `delivery_address.coordinates.longitude`  | Não         | Number  | Longitude.                                                                        |
| `items`                                   | Sim         | Array   | Lista de itens do pedido.                                                         |
| `items[].integration_code`                | Sim         | String  | Código de integração do item.                                                     |
| `items[].desc_item`                       | Sim         | String  | Descrição do item.                                                                |
| `items[].quantity`                        | Sim         | Integer | Quantidade do item.                                                               |
| `items[].unit_price`                      | Sim         | Number  | Preço unitário do item.                                                           |
| `items[].notes`                           | Não         | String  | Observações do item.                                                              |
| `items[].id_store_waiter`                 | Não         | String  | Identificador do garçom.                                                          |
| `items[].choice_items`                    | Não         | Array   | Lista de adicionais/complementos.                                                 |
| `items[].choice_items[].integration_code` | Sim         | String  | Código de integração do adicional.                                                |
| `items[].choice_items[].desc_item_choice` | Sim         | String  | Descrição do adicional.                                                           |
| `items[].choice_items[].aditional_price`  | Sim         | Number  | Preço adicional.                                                                  |
| `items[].choice_items[].quantity`         | Sim         | Integer | Quantidade do adicional.                                                          |
| `items[].choice_items[].notes`            | Não         | String  | Observações do adicional.                                                         |
| `payment_types`                           | Sim         | Array   | Lista de formas de pagamento.                                                     |
| `payment_types[].code`                    | Sim         | String  | Código da forma de pagamento.                                                     |
| `payment_types[].amount`                  | Sim         | Number  | Valor pago na forma de pagamento.                                                 |
| `payment_types[].change_for`              | Sim         | Number  | Valor para troco.                                                                 |
| `payment_types[].complement`              | Não         | String  | Complemento da forma de pagamento.                                                |
| `payment_types[].type`                    | Não         | String  | Tipo do pagamento (`ONLINE` ou `OFFLINE`).                                        |

## `POST /order` - TAKEOUT

| Propriedade                               | Obrigatório | Tipo    | Descrição                                                                         |
| ----------------------------------------- | ----------- | ------- | --------------------------------------------------------------------------------- |
| `order_id`                                | Sim         | String  | ID do pedido.                                                                     |
| `display_id`                              | Sim         | String  | Identificador visível do pedido.                                                  |
| `cod_store`                               | Sim         | String  | Código da loja.                                                                   |
| `created_at`                              | Sim         | String  | Data/hora de criação do pedido.                                                   |
| `notes`                                   | Não         | String  | Observações do pedido.                                                            |
| `total_discount`                          | Sim         | Number  | Valor total de desconto.                                                          |
| `total_increase`                          | Não         | Number  | Valor total de acréscimo.                                                         |
| `otherFees`                               | Não         | Object  | Dados de taxas adicionais que compõem o campo `total_increase`                    |
| `otherFees.description`                   | Não         | String  | Descrição textual da taxa . Exemplo: "Taxa de Serviço" ou "Taxa de pedido mínimo" |
| `otherFees.type`                          | Sim         | String  | Tipo da taxa aplicada (`SERVICE_FEE` ou`MIN_ORDER_FEE`).                          |
| `otherFees.liability`                     | Sim         | String  | Responsável financeiro pela taxa (`PARTNER` ou`RESTAURANT`).                      |
| `otherFees.value`                         | Sim         | Number  | Valor da taxa aplicada                                                            |
| `total_amount`                            | Não         | Number  | Valor total informado pelo parceiro.                                              |
| `customer`                                | Sim         | Object  | Dados do cliente.                                                                 |
| `customer.id`                             | Sim         | String  | ID do cliente.                                                                    |
| `customer.name`                           | Sim         | String  | Nome do cliente.                                                                  |
| `customer.phone`                          | Sim         | String  | Telefone do cliente.                                                              |
| `customer.email`                          | Não         | String  | E-mail do cliente.                                                                |
| `customer.document_number`                | Não         | String  | Documento do cliente.                                                             |
| `customer.localizer`                      | Não         | String  | Localizador externo do cliente.                                                   |
| `order_method`                            | Sim         | Object  | Dados do método do pedido.                                                        |
| `order_method.mode`                       | Sim         | String  | Tipo do pedido (`TAKEOUT`).                                                       |
| `order_method.scheduled`                  | Sim         | Boolean | Indica se o pedido é agendado.                                                    |
| `order_method.delivery_date_time`         | Sim         | String  | Data/hora da retirada.                                                            |
| `order_method.pickupCode`                 | Não         | String  | Código de retirada/validação.                                                     |
| `items`                                   | Sim         | Array   | Lista de itens do pedido.                                                         |
| `items[].integration_code`                | Sim         | String  | Código de integração do item.                                                     |
| `items[].desc_item`                       | Sim         | String  | Descrição do item.                                                                |
| `items[].quantity`                        | Sim         | Integer | Quantidade do item.                                                               |
| `items[].unit_price`                      | Sim         | Number  | Preço unitário do item.                                                           |
| `items[].notes`                           | Não         | String  | Observações do item.                                                              |
| `items[].id_store_waiter`                 | Não         | String  | Identificador do garçom.                                                          |
| `items[].choice_items`                    | Não         | Array   | Lista de adicionais/complementos.                                                 |
| `items[].choice_items[].integration_code` | Sim         | String  | Código de integração do adicional.                                                |
| `items[].choice_items[].desc_item_choice` | Sim         | String  | Descrição do adicional.                                                           |
| `items[].choice_items[].aditional_price`  | Sim         | Number  | Preço adicional.                                                                  |
| `items[].choice_items[].quantity`         | Sim         | Integer | Quantidade do adicional.                                                          |
| `items[].choice_items[].notes`            | Não         | String  | Observações do adicional.                                                         |
| `payment_types`                           | Sim         | Array   | Lista de formas de pagamento.                                                     |
| `payment_types[].code`                    | Sim         | String  | Código da forma de pagamento.                                                     |
| `payment_types[].amount`                  | Sim         | Number  | Valor pago na forma de pagamento.                                                 |
| `payment_types[].change_for`              | Sim         | Number  | Valor para troco.                                                                 |
| `payment_types[].complement`              | Não         | String  | Complemento da forma de pagamento.                                                |
| `payment_types[].type`                    | Não         | String  | Tipo do pagamento (`ONLINE` ou `OFFLINE`).                                        |

## `POST /order` - TICKET

| Propriedade                               | Obrigatório | Tipo    | Descrição                                                                         |
| ----------------------------------------- | ----------- | ------- | --------------------------------------------------------------------------------- |
| `order_id`                                | Sim         | String  | ID do pedido.                                                                     |
| `display_id`                              | Sim         | String  | Identificador visível do pedido.                                                  |
| `cod_store`                               | Sim         | String  | Código da loja.                                                                   |
| `created_at`                              | Sim         | String  | Data/hora de criação do pedido.                                                   |
| `notes`                                   | Não         | String  | Observações do pedido.                                                            |
| `total_discount`                          | Sim         | Number  | Valor total de desconto.                                                          |
| `total_increase`                          | Não         | Number  | Valor total de acréscimo.                                                         |
| `otherFees`                               | Não         | Object  | Dados de taxas adicionais que compõem o campo `total_increase`                    |
| `otherFees.description`                   | Não         | String  | Descrição textual da taxa . Exemplo: "Taxa de Serviço" ou "Taxa de pedido mínimo" |
| `otherFees.type`                          | Sim         | String  | Tipo da taxa aplicada (`SERVICE_FEE` ou`MIN_ORDER_FEE`).                          |
| `otherFees.liability`                     | Sim         | String  | Responsável financeiro pela taxa (`PARTNER` ou`RESTAURANT`).                      |
| `otherFees.value`                         | Sim         | Number  | Valor da taxa aplicada                                                            |
| `total_amount`                            | Não         | Number  | Valor total informado pelo parceiro.                                              |
| `customer`                                | Sim         | Object  | Dados do cliente.                                                                 |
| `customer.id`                             | Sim         | String  | ID do cliente.                                                                    |
| `customer.name`                           | Sim         | String  | Nome do cliente.                                                                  |
| `customer.phone`                          | Não         | String  | Telefone do cliente.                                                              |
| `customer.email`                          | Não         | String  | E-mail do cliente.                                                                |
| `customer.document_number`                | Não         | String  | Documento do cliente.                                                             |
| `order_method`                            | Sim         | Object  | Dados do método do pedido.                                                        |
| `order_method.mode`                       | Sim         | String  | Tipo do pedido (`TICKET`).                                                        |
| `order_method.ticket_reference`           | Não         | String  | Referência da ficha.                                                              |
| `items`                                   | Sim         | Array   | Lista de itens do pedido.                                                         |
| `items[].integration_code`                | Sim         | String  | Código de integração do item.                                                     |
| `items[].desc_item`                       | Sim         | String  | Descrição do item.                                                                |
| `items[].quantity`                        | Sim         | Integer | Quantidade do item.                                                               |
| `items[].unit_price`                      | Sim         | Number  | Preço unitário do item.                                                           |
| `items[].notes`                           | Não         | String  | Observações do item.                                                              |
| `items[].id_store_waiter`                 | Não         | String  | Identificador do garçom.                                                          |
| `items[].choice_items`                    | Não         | Array   | Lista de adicionais/complementos.                                                 |
| `items[].choice_items[].integration_code` | Sim         | String  | Código de integração do adicional.                                                |
| `items[].choice_items[].desc_item_choice` | Sim         | String  | Descrição do adicional.                                                           |
| `items[].choice_items[].aditional_price`  | Sim         | Number  | Preço adicional.                                                                  |
| `items[].choice_items[].quantity`         | Sim         | Integer | Quantidade do adicional.                                                          |
| `items[].choice_items[].notes`            | Não         | String  | Observações do adicional.                                                         |
| `payment_types`                           | Sim         | Array   | Lista de formas de pagamento.                                                     |
| `payment_types[].code`                    | Sim         | String  | Código da forma de pagamento.                                                     |
| `payment_types[].amount`                  | Sim         | Number  | Valor pago na forma de pagamento.                                                 |
| `payment_types[].change_for`              | Sim         | Number  | Valor para troco.                                                                 |
| `payment_types[].complement`              | Não         | String  | Complemento da forma de pagamento.                                                |
| `payment_types[].type`                    | Não         | String  | Tipo do pagamento (`ONLINE` ou `OFFLINE`).                                        |

## `POST /order` - TABLE

| Propriedade                               | Obrigatório | Tipo    | Descrição                                  |
| ----------------------------------------- | ----------- | ------- | ------------------------------------------ |
| `order_id`                                | Sim         | String  | ID do pedido.                              |
| `display_id`                              | Sim         | String  | Identificador visível do pedido.           |
| `cod_store`                               | Sim         | String  | Código da loja.                            |
| `created_at`                              | Sim         | String  | Data/hora de criação do pedido.            |
| `notes`                                   | Não         | String  | Observações do pedido.                     |
| `total_discount`                          | Não         | Number  | Valor total de desconto.                   |
| `total_increase`                          | Não         | Number  | Valor total de acréscimo.                  |
| `total_amount`                            | Não         | Number  | Valor total informado pelo parceiro.       |
| `customer`                                | Não         | Object  | Dados do cliente.                          |
| `customer.id`                             | Não         | String  | ID do cliente.                             |
| `customer.name`                           | Não         | String  | Nome do cliente.                           |
| `customer.phone`                          | Não         | String  | Telefone do cliente.                       |
| `customer.email`                          | Não         | String  | E-mail do cliente.                         |
| `customer.document_number`                | Não         | String  | Documento do cliente.                      |
| `order_method`                            | Sim         | Object  | Dados do método do pedido.                 |
| `order_method.mode`                       | Sim         | String  | Tipo do pedido (`TABLE`).                  |
| `order_method.table_reference`            | Não         | String  | Referência da mesa.                        |
| `order_method.desc_sale`                  | Não         | String  | Descrição da venda.                        |
| `items`                                   | Sim         | Array   | Lista de itens do pedido.                  |
| `items[].integration_code`                | Não         | String  | Código de integração do item.              |
| `items[].desc_item`                       | Não         | String  | Descrição do item.                         |
| `items[].quantity`                        | Não         | Integer | Quantidade do item.                        |
| `items[].unit_price`                      | Não         | Number  | Preço unitário do item.                    |
| `items[].notes`                           | Não         | String  | Observações do item.                       |
| `items[].id_store_waiter`                 | Não         | String  | Identificador do garçom.                   |
| `items[].choice_items`                    | Não         | Array   | Lista de adicionais/complementos.          |
| `items[].choice_items[].integration_code` | Sim         | String  | Código de integração do adicional.         |
| `items[].choice_items[].desc_item_choice` | Sim         | String  | Descrição do adicional.                    |
| `items[].choice_items[].aditional_price`  | Sim         | Number  | Preço adicional.                           |
| `items[].choice_items[].quantity`         | Sim         | Integer | Quantidade do adicional.                   |
| `items[].choice_items[].notes`            | Não         | String  | Observações do adicional.                  |
| `table`                                   | Sim         | Object  | Dados de mesa/comanda.                     |
| `table.integration_code`                  | Não         | String  | Código de integração da mesa.              |
| `table.desc_table`                        | Não         | String  | Identificador da mesa.                     |
| `table.desc_order_pad`                    | Não         | String  | Identificador da comanda.                  |
| `payment_types`                           | Não         | Array   | Lista de formas de pagamento.              |
| `payment_types[].code`                    | Não         | String  | Código da forma de pagamento.              |
| `payment_types[].amount`                  | Não         | Number  | Valor pago na forma de pagamento.          |
| `payment_types[].change_for`              | Não         | Number  | Valor para troco.                          |
| `payment_types[].complement`              | Não         | String  | Complemento da forma de pagamento.         |
| `payment_types[].type`                    | Não         | String  | Tipo do pagamento (`ONLINE` ou `OFFLINE`). |

## `PUT /order` - TABLE

| Propriedade                               | Obrigatório | Tipo    | Descrição                                  |
| ----------------------------------------- | ----------- | ------- | ------------------------------------------ |
| `order_id`                                | Sim         | String  | ID do pedido.                              |
| `cod_store`                               | Sim         | String  | Código da loja.                            |
| `created_at`                              | Não         | String  | Data/hora da inserção dos itens.           |
| `display_id`                              | Não         | String  | Identificador visível do pedido.           |
| `customer`                                | Não         | Object  | Dados do cliente.                          |
| `order_method`                            | Sim         | Object  | Dados do método do pedido.                 |
| `order_method.mode`                       | Sim         | String  | Tipo do pedido (`TABLE`).                  |
| `order_method.table_reference`            | Não         | String  | Referência da mesa.                        |
| `order_method.desc_sale`                  | Não         | String  | Descrição da venda.                        |
| `items`                                   | Sim         | Array   | Lista de itens do pedido.                  |
| `items[].integration_code`                | Sim         | String  | Código de integração do item.              |
| `items[].item_external_code`              | Sim         | String  | Identificador externo do item.             |
| `items[].desc_item`                       | Sim         | String  | Descrição do item.                         |
| `items[].quantity`                        | Sim         | Integer | Quantidade do item.                        |
| `items[].unit_price`                      | Sim         | Number  | Preço unitário do item.                    |
| `items[].notes`                           | Não         | String  | Observações do item.                       |
| `items[].id_store_waiter`                 | Não         | String  | Identificador do garçom.                   |
| `items[].choice_items`                    | Não         | Array   | Lista de adicionais/complementos.          |
| `items[].choice_items[].integration_code` | Sim         | String  | Código de integração do adicional.         |
| `items[].choice_items[].desc_item_choice` | Sim         | String  | Descrição do adicional.                    |
| `items[].choice_items[].aditional_price`  | Sim         | Number  | Preço adicional.                           |
| `items[].choice_items[].quantity`         | Sim         | Integer | Quantidade do adicional.                   |
| `items[].choice_items[].notes`            | Não         | String  | Observações do adicional.                  |
| `payment_types`                           | Não         | Array   | Lista de formas de pagamento.              |
| `payment_types[].code`                    | Não         | String  | Código da forma de pagamento.              |
| `payment_types[].amount`                  | Não         | Number  | Valor pago na forma de pagamento.          |
| `payment_types[].change_for`              | Não         | Number  | Valor para troco.                          |
| `payment_types[].complement`              | Não         | String  | Complemento da forma de pagamento.         |
| `payment_types[].type`                    | Não         | String  | Tipo do pagamento (`ONLINE` ou `OFFLINE`). |

## `GET /order`

| Propriedade | Obrigatório | Tipo   | Descrição       |
| ----------- | ----------- | ------ | --------------- |
| `order_id`  | Sim         | String | ID do pedido.   |
| `cod_store` | Sim         | String | Código da loja. |

## `PUT /order-status`

| Nome do campo | Obrigatório | Tipo   | Descrição                            |
| ------------- | ----------- | ------ | ------------------------------------ |
| `order_id`    | Sim         | String | ID do pedido.                        |
| `cod_store`   | Sim         | String | Código da loja.                      |
| `status`      | Sim         | String | Status da venda (`CLOSE_REQUESTED`). |

## `GET /sale-status-by-table-or-pad`

| Nome do campo | Obrigatório | Tipo   | Descrição                                                                                      |
| ------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------- |
| `table`       | Condicional | String | Array em formato de string para consulta de mesas (obrigatório se `pad` não for enviado).      |
| `pad`         | Condicional | String | Array em formato de string para consulta de comandas (obrigatório se `table` não for enviado). |

## `POST /change-table`

| Nome do campo | Obrigatório | Tipo   | Descrição                         |
| ------------- | ----------- | ------ | --------------------------------- |
| `table`       | Sim         | String | Identificador da mesa de destino. |
| `order_id`    | Sim         | String | ID do pedido.                     |

## `POST /convert-orders-in-table`

| Nome do campo | Obrigatório | Tipo   | Descrição                             |
| ------------- | ----------- | ------ | ------------------------------------- |
| `table`       | Sim         | String | Identificador da mesa para conversão. |