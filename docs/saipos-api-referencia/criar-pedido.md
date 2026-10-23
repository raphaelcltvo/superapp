---
updatedAt: 2026-08-05T17:31:19.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Criar pedido

É por meio desse endpoint que deverá ser criado o pedido dentro do Sistema Saipos.

## Casos de uso

Para auxiliar no entendimento de qual é a forma ideal de integrar o pedido no Sistema Saipos, disponibilizamos alguns casos de uso comuns.<br />Integrar o pedido da forma correta, garante boa experiência para o cliente e para o restaurante, evitando atritos e falhas no pedido e garantindo fluidez no processo de integração.

| Caso de uso               | Como integrar                                                                                                                                                                                                                       |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Totem de auto-atendimento | Utilizar pedido de TICKET na Saipos. Desta forma, o identificador único enviado pelo parceiro é integrado ao pedido dentro do Sistema Saipos.                                                                                       |
| Atendimento de senha      | Utilizar pedido de TICKET na Saipos. A senha enviada fica vinculada ao pedido, e o restaurante pode chamar o cliente através da senha.                                                                                              |
| Atendimento de shopping   | Utilizar pedido de TICKET na Saipos. Ao realizar o pedido no balcão, o cliente recebe um número que, vinculado ao pedido da Saipos, permite a identificação do cliente/pedido quando este estiver pronto.                           |
| Entrega/Delivery          | Utilizar o pedido de DELIVERY na Saipos. Através do endereço e cliente enviado no pedido, o restaurante deve entregar o pedido no endereço solicitado, utilizando entrega própria ou as integrações de entrega que a Saipos dispõe. |
| Pegue e leve              | Utilizar o pedido de TAKEOUT na Saipos. O cliente faz o pedido e se desloca até o restaurante para retirar o pedido no tempo estimado na plataforma de parceiro.                                                                    |
| Atendimento de mesa       | Utilizar o pedido de TABLE na Saipos. O cliente faz o pedido, que fica aberto para consumo recorrente, até que ele opte por pedir a conta e encerrar o pedido.                                                                      |

## Módulos de pedidos

#### DELIVERY

Deve ser informada a propriedade `order_method.delivery_by`, indicando quem será responsável pela entrega do pedido até a casa do cliente, e caso o valor seja 'RESTAURANT' deve ser informado o objeto `delivery_address`.<br />Também, deve ser informado o valor de `order_method.delivery_fee`, com o valor da taxa de entrega.

#### TAKEOUT

É considerada venda de Delivery Balcão, onde o cliente irá retirar o pedido na loja.

#### TICKET

É considerada venda de Ticket na Saipos, podendo ser usado para integração com Totem

* O campo `order_method.ticket_reference` pode ser utilizado para envio do número do ticket na plataforma do parceiro, que na Saipos será considerada apenas uma observação na venda. O número da venda de ticket na no Sistema Saipos é definido de acordo com a configuração escolhida pela loja, podendo ser incremental ou randomica.

#### TABLE

É considera venda de Mesa na Saipos<br />O campo `order_method.table_reference` pode ser utilizado para envio da referência de mesa/comanda na plataforma do parceiro, que na Saipos será considerada apenas uma observação na venda.<br />A mesa na qual a venda será vinculada na Saipos é definida pelo campo `table.integration_code`, onde deve ser enviado a referência da mesa. O número da comanda no Sistema Saipos é definido internamente.

## Cálculo dos Itens

O valor **total dos itens** será calculado pela Saipos, a partir da seguintes passos, para cada item enviado:<br />1 - Valor total do adicional do item: *(aditional\_price x quantity)*;<br />2 - Soma do total de todos adicionais do item;<br />3 - Valor total do item: *(( unit\_price + Soma total dos itens ) x quantity)*;

O valor **total da venda** será calculado pelo sistema Saipos a partir dos seguintes passos:<br />1 - Soma total de todos os itens calculados acima;<br />2 - Subtração do total\_discount do valor;<br />3 - Se entrega for MERCHANT, soma do `delivery_fee` ao valor;

## Exemplo de JSON para pedidos de Delivery entregue pelo Parceiro

Este tipo de pedido será integrado como pedido de Delivery com entrega pelo parceiro.

<Callout icon="🚧" theme="warn">
  ### Importante

  Os campos city e state devem ser validos, caso contrario o sistema retornará erro informando que a cidade ou o estado não existem.
</Callout>

<Callout icon="📘" theme="info">
  ### Cliente não identificado

  Caso não queira identificar o cliente, o campo **customer.id** deverá receber o valor como  -1
</Callout>

```json
{
  "order_id": "54515487548787",
  "display_id": "5457",
  "cod_store": "123",
  "created_at": "2020-10-08T01:25:49.992093Z",
  "notes": "",
  "total_increase": 10,
  "otherFees": [
    {
          "description": "Taxa de serviço",
          "type": "SERVICE_FEE",
          "liability": "PARTNER",
          "value": 10
        },
    {
          "description": "Taxa de pedido mínimo",
          "type": "MIN_ORDER_FEE",
          "liability": "RESTAURANT",
          "value": 0
        }
   ],
  "total_discount": 10,
  "total_amount": 10,
  "customer": {
    "id": "247559798",
    "name": "PEDIDO DE TESTE - Jonathan Stein",
    "phone": "51996033508",
    "email": "testes@gmail.com.br",
    "document_number": "22919153048",
    "localizer": "12345B5"
  },
  "order_method": {
    "mode": "DELIVERY",
    "delivery_by": "PARTNER",
    "delivery_fee": 1,
    "scheduled": true,
    "delivery_date_time": "2020-10-08T01:35:49.992093Z",
    "pickupCode": "423432"
  },
  "delivery_address": {
    "country": "BR",
    "state": "RS",
    "city": "São Leopoldo",
    "district": "Centro",
    "street_name": "PEDIDO DE TESTE - NÃO ENTREGAR - R. Divina Luz",
    "street_number": "90",
    "postal_code": "93180000",
    "reference": "Do lado do teste",
    "complement": "Teste",
    "coordinates": {
      "latitude": -9.825868,
      "longitude": -67.948632
    }
  },
  "items": [
    {
      "integration_code": "1234",
      "desc_item": "PEDIDO DE TESTE - PEQUENO",
      "quantity": 1,
      "unit_price": 0,
      "notes": "",
      "choice_items": [
        {
          "integration_code": "1111",
          "desc_item_choice": "Massa massa doce + Borda normal",
          "aditional_price": 3,
          "quantity": 1,
          "notes": ""
        },
        {
          "integration_code": "2222",
          "desc_item_choice": "Queijo",
          "aditional_price": 10,
          "quantity": 1,
          "notes": ""
        }
      ]
    }
  ],
  "payment_types": [
    {
      "code": "DIN",
      "amount": 3,
      "change_for": 0
    }
  ]
}
```

## Exemplo de JSON para pedidos de Delivery entregue pelo Restaurante

Este tipo de pedido será integrado como pedido de Delivery com entrega pelo restaurante.

<Callout icon="🚧" theme="warn">
  ### Importante

  Os campos city e state devem ser validos, caso contrario o sistema retornará erro informando que a cidade ou o estado não existem.
</Callout>

```json
{
  "order_id": "54515487548787",
  "display_id": "5457",
  "cod_store": "123",
  "created_at": "2020-10-08T01:25:49.992093Z",
  "notes": "",
  "total_increase": 10,
  "otherFees": [
    {
          "description": "Taxa de serviço",
          "type": "SERVICE_FEE",
          "liability": "PARTNER",
          "value": 10
        },
    {
          "description": "Taxa de pedido mínimo",
          "type": "MIN_ORDER_FEE",
          "liability": "RESTAURANT",
          "value": 0
        }
   ],
  "total_discount": 10,
  "total_amount": 10,
  "customer": {
    "id": "247559798",
    "name": "PEDIDO DE TESTE - Jonathan Stein",
    "phone": "51996033508",
    "email": "testes@gmail.com.br",
    "document_number": "22919153048",
    "localizer": "12345B5"
  },
  "order_method": {
    "mode": "DELIVERY",
    "delivery_by": "RESTAURANT",
    "scheduled": true,
    "delivery_date_time": "2020-10-08T01:35:49.992093Z",
    "pickupCode": "423432"
  },
  "items": [
    {
      "integration_code": "1234",
      "desc_item": "PEDIDO DE TESTE - PEQUENO",
      "quantity": 1,
      "unit_price": 0,
      "notes": "",
      "choice_items": [
        {
          "integration_code": "1111",
          "desc_item_choice": "Massa massa doce + Borda normal",
          "aditional_price": 3,
          "quantity": 1,
          "notes": ""
        },
        {
          "integration_code": "2222",
          "desc_item_choice": "Queijo",
          "aditional_price": 10,
          "quantity": 1,
          "notes": ""
        }
      ]
    }
  ],
  "payment_types": [
    {
      "code": "DIN",
      "amount": 3,
      "change_for": 0
    }
  ]
}
```

## Exemplo de JSON para pedidos de Ticket

Esse tipo de pedido será integrado como pedidos de FICHA. Muito comum em operações de shopping.

```json
{
  "order_id": "54515487548787",
  "display_id": "5457",
  "cod_store": "123",
  "created_at": "2020-10-08T01:25:49.992093Z",
  "notes": "",
  "total_increase": 10,
  "otherFees": [
    {
          "description": "Taxa de serviço",
          "type": "SERVICE_FEE",
          "liability": "PARTNER",
          "value": 10
        },
    {
          "description": "Taxa de pedido mínimo",
          "type": "MIN_ORDER_FEE",
          "liability": "RESTAURANT",
          "value": 0
        }
   ],
  "total_discount": 10,
  "total_amount": 10,
  "customer": {
    "id": "247559798",
    "name": "PEDIDO DE TESTE - Jonathan Stein",
    "phone": "51996033508",
    "email": "testes@gmail.com.br",
    "document_number": "22919153048"
  },
  "order_method": {
    "mode": "TICKET",
    "ticket_reference": "Ticket 02"
  },
  "items": [
    {
      "integration_code": "1234",
      "desc_item": "PEDIDO DE TESTE - PEQUENO",
      "quantity": 1,
      "unit_price": 0,
      "notes": "",
      "choice_items": [
        {
          "integration_code": "1111",
          "desc_item_choice": "Massa massa doce + Borda normal",
          "aditional_price": 3,
          "quantity": 1,
          "notes": ""
        },
        {
          "integration_code": "2222",
          "desc_item_choice": "Queijo",
          "aditional_price": 10,
          "quantity": 1,
          "notes": ""
        }
      ]
    }
  ],
  "payment_types": [
    {
      "code": "DIN",
      "amount": 3,
      "change_for": 0
    }
  ]
}
```

## Exemplo de JSON para pedidos de retirada

Esse tipo de pedido será integrado como pedidos de Balcão.

```json
{
  "order_id": "54515487548787",
  "display_id": "5457",
  "cod_store": "123",
  "created_at": "2020-10-08T01:25:49.992093Z",
  "notes": "",
  "total_increase": 10,
  "otherFees": [
    {
          "description": "Taxa de serviço",
          "type": "SERVICE_FEE",
          "liability": "PARTNER",
          "value": 10
        },
    {
          "description": "Taxa de pedido mínimo",
          "type": "MIN_ORDER_FEE",
          "liability": "RESTAURANT",
          "value": 0
        }
   ],
  "total_discount": 10,
  "total_amount": 10,
  "customer": {
    "id": "247559798",
    "name": "PEDIDO DE TESTE - Jonathan Stein",
    "phone": "51996033508",
    "email": "testes@gmail.com.br",
    "document_number": "22919153048",
    "localizer": "12345B5"
  },
  "order_method": {
    "mode": "TAKEOUT",
    "scheduled": false,
    "delivery_date_time": "2020-10-08T01:25:49.992093Z",
    "pickupCode": "423432"
  },
  "items": [
    {
      "integration_code": "1234",
      "desc_item": "PEDIDO DE TESTE - PEQUENO",
      "quantity": 1,
      "unit_price": 0,
      "notes": "",
      "choice_items": [
        {
          "integration_code": "1111",
          "desc_item_choice": "Massa massa doce + Borda normal",
          "aditional_price": 3,
          "quantity": 1,
          "notes": ""
        },
        {
          "integration_code": "2222",
          "desc_item_choice": "Queijo",
          "aditional_price": 10,
          "quantity": 1,
          "notes": ""
        }
      ]
    }
  ],
  "payment_types": [
    {
      "code": "DIN",
      "amount": 3,
      "change_for": 0
    }
  ]
}
```

## Exemplo de JSON para pedidos de Table

```json
{
  "order_id": "54515487548787",
  "display_id": "5457",
  "cod_store": "123",
  "created_at": "2020-10-08T01:25:49.992093Z",
  "notes": "",
  "total_discount": 10,
  "total_amount": 10,
  "customer": {
    "id": "247559798",
    "name": "PEDIDO DE TESTE - Jonathan Stein",
    "phone": "51996033508",
    "email": "testes@gmail.com.br",
    "document_number": "22919153048"
  },
  "order_method": {
    "mode": "TABLE",
    "table_reference": ""
  },
  "items": [
    {
      "integration_code": "1234",
      "desc_item": "PEDIDO DE TESTE - PEQUENO",
      "quantity": 1,
      "unit_price": 0,
      "notes": "",
      "id_store_waiter": "10",
      "choice_items": [
        {
          "integration_code": "1111",
          "desc_item_choice": "Massa massa doce + Borda normal",
          "aditional_price": 3,
          "quantity": 1,
          "notes": ""
        },
        {
          "integration_code": "2222",
          "desc_item_choice": "Queijo",
          "aditional_price": 10,
          "quantity": 1,
          "notes": ""
        }
      ]
    }
  ],
  "table": {
    "desc_table": "12345"
  }
}
```

### Adição de mais itens na Mesa

<Callout icon="🚧" theme="warn">
  ### Adição em Mesa com pedido manual

  Para adicionar itens em uma mesa que foi aberta manualmente na Saipos, é necessário realizar a conversão do pedido desta mesa em pedido de integração conforme descrito **[aqui](https://saipos-docs-order-api.readme.io/reference/converter-pedido-manual-em-pedido-integracao)**

  Após a conversão do pedido, é possível realizar a adição de mais itens na Mesa seguindo os passos descritos a seguir.
</Callout>

O sistema de comanda permite a adição de novos *items* na comanda. Para isso, é necessário fazer uma requisição com o mesmo *body* para a mesma rota de criação do pedido. Os números de `desc_table` e `order_id` devem ser o mesmo. Dessa forma, ao integrar, o sistema irá adicionar os itens à mesa.

<Callout icon="📘" theme="info">
  ### Pagamento para Mesa

  Nosso sistema, atualmente, não tem suporte para pagamentos da mesa.
</Callout>

## Exemplo de JSON para pedidos de Comanda

```json
{
  "order_id": "54515487548787",
  "display_id": "5457",
  "cod_store": "123",
  "created_at": "2020-10-08T01:25:49.992093Z",
  "notes": "",
  "total_discount": 10,
  "total_amount": 10,
  "customer": {
    "id": "247559798",
    "name": "PEDIDO DE TESTE - Jonathan Stein",
    "phone": "51996033508",
    "email": "testes@gmail.com.br",
    "document_number": "22919153048"
  },
  "order_method": {
    "mode": "TABLE",
    "table_reference": ""
  },
  "items": [
    {
      "integration_code": "1234",
      "desc_item": "PEDIDO DE TESTE - PEQUENO",
      "quantity": 1,
      "unit_price": 0,
      "notes": "",
      "id_store_waiter": "10",
      "choice_items": [
        {
          "integration_code": "1111",
          "desc_item_choice": "Massa massa doce + Borda normal",
          "aditional_price": 3,
          "quantity": 1,
          "notes": ""
        },
        {
          "integration_code": "2222",
          "desc_item_choice": "Queijo",
          "aditional_price": 10,
          "quantity": 1,
          "notes": ""
        }
      ]
    }
  ],
  "table": {
    "desc_order_pad": "12345"
  }
}
```

### Adição de mais itens na Comanda

O sistema de comanda permite a adição de novos *items* na comanda. Para isso, é necessário fazer uma requisição com o mesmo *body* para a mesma rota de criação do pedido. Os números de `desc_order_pad` e `order_id` devem ser o mesmo. Dessa forma, ao integrar, o sistema irá adicionar os itens à comanda.

<Callout icon="📘" theme="info">
  ### Pagamento da Comanda

  Nosso sistema, atualmente, não tem suporte para pagamentos da comanda.
</Callout>

<Callout icon="📘" theme="info">
  ### Garçons

  Em pedidos de mesa ou comanda é possível relacionar o garçom ao item adicionado.

  Deve-se passar o campo id_store_waiter com o identificador do garçom.

  Essa informações pode ser consultada através do endpoint de garçons.
</Callout>

# OpenAPI definition

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "order-integration",
    "version": "2.5"
  },
  "servers": [
    {
      "url": "https://order-api.saipos.com"
    }
  ],
  "components": {
    "securitySchemes": {
      "sec0": {
        "type": "apiKey",
        "in": "query",
        "name": "api_key"
      }
    }
  },
  "security": [
    {
      "sec0": []
    }
  ],
  "paths": {
    "/order": {
      "post": {
        "summary": "Criar pedido",
        "description": "É por meio desse endpoint que deverá ser criado o pedido dentro do Sistema Saipos.",
        "operationId": "criar-pedido",
        "parameters": [
          {
            "name": "Authorization",
            "in": "header",
            "description": "Neste campo é necessário informar o token gerado na rota de autenticação.",
            "schema": {
              "type": "string",
              "default": "aqui_vai_seu_token_gerado"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "RAW_BODY": {
                    "type": "string",
                    "default": "{    \"order_id\":\"54515487548787\",    \"display_id\":\"5457\",    \"cod_store\":\"123\",    \"created_at\":\"2020-10-08T01:25:49.992093Z\",    \"notes\":\"\",    \"total_increase\":10,    \"total_discount\":10,    \"total_amount\":10,    \"customer\":{       \"id\":\"247559798\",       \"name\":\"PEDIDO DE TESTE - Jonathan Stein\",       \"phone\":\"51996033508\",       \"document_number\":\"22919153048\"    },    \"order_method\":{       \"mode\":\"DELIVERY\",       \"delivery_by\":\"PARTNER\",       \"delivery_fee\":1,       \"scheduled\":true,       \"delivery_date_time\":\"2020-10-08T01:35:49.992093Z\"    },    \"delivery_address\":{       \"country\":\"BR\",       \"state\":\"RS\",       \"city\":\"São Leopoldo\",       \"district\":\"Centro\",       \"street_name\":\"PEDIDO DE TESTE - NÃO ENTREGAR - R. Divina Luz\",       \"street_number\":\"90\",       \"postal_code\":\"93180000\",       \"reference\":\"Do lado do teste\",       \"complement\":\"Teste\",       \"coordinates\":{          \"latitude\":-9.825868,          \"longitude\":-67.948632       }    },    \"items\":[       {          \"integration_code\":\"1234\",          \"desc_item\":\"PEDIDO DE TESTE - PEQUENO\",          \"quantity\":1,          \"unit_price\":0,          \"notes\":\"\",          \"choice_items\":[             {                \"integration_code\":\"1111\",                \"desc_item_choice\":\"Massa massa doce + Borda normal\",                \"aditional_price\":3,                \"quantity\":1,                \"notes\":\"\"             },             {                \"integration_code\":\"2222\",                \"desc_item_choice\":\"Queijo\",                \"aditional_price\":10,                \"quantity\":1,                \"notes\":\"\"             }          ]       }    ],    \"payment_types\":[       {          \"code\":\"DIN\",          \"amount\":3,          \"change_for\":0       }    ] }",
                    "format": "json"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          }
        },
        "security": []
      }
    }
  },
  "x-readme": {
    "headers": [],
    "explorer-enabled": true,
    "proxy-enabled": true
  },
  "x-readme-fauxas": true
}
```