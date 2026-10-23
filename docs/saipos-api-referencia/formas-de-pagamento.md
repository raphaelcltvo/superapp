---
updatedAt: 2026-03-02T22:03:25.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Formas de pagamento

Detalhes importantes para garantir que a forma de pagamento seja identificada corretamente ao criar um pedido no Sistema Saipos.

É possível enviar pagamentos apenas para pedidos de TICKET e DELIVERY.

* **TICKET:** Refere-se aos pedidos em que o restaurante opera com o modo ficha, um tipo de operação comum em shoppings.
* **DELIVERY:** Inclui pedidos entregues pelo restaurante, pelo parceiro ou retirados no balcão.

Os dados enviados na propriedade "*payment\_types*" serão atribuídos à venda como formas de pagamento.

Dentro do PDV SAIPOS há uma tela para adicionar as formas de pagamento. Por padrão, essas são as formas de pagamento adicionadas pelo sistema:

![](https://files.readme.io/a9fa6b6-image.png)

É *opcional* adicionar um *complement* para cada forma de pagamento. Caso decida utilizar o campo COMPLEMENTO, ele deve ser enviado exatamente da mesma forma dentro do JSON do pedido (case sensitive).

**ATENÇÃO: Para pagamentos ONLINE**, deve ser enviado o campo **"type"** com o valor **"ONLINE"**.

> 🚧 Alteração das formas de pagamento
>
> Se o restaurante configurar novas formas de pagamento, o parceiro deve atualizar o envio para garantir a identificação correta dentro do PDV SAIPOS.

Exemplos de como enviar pagamentos para pedidos, conforme as formas padrão acima. A coluna SAIPOS é referente a como o pedido vai aparecer dentro do PDV.

**Código:** OTHER\
**Complemento:** vazio\
**Descrição:** Outros\
**SAIPOS:** Pagamento não cadastrado\
**Pagamento online:** não

```json
{
    "code": "OTHER",
    "amount": 29.9,
    "change_for": 0,
    "complement": "",
    "type": "OFFLINE"
}
```

**Código:** Vale (VALE)\
**Complemento:** vazio\
**Descrição:** Vale\
**SAIPOS:** Pagamento não cadastrado\
**Pagamento online:** não

```json
{
    "code": "VALE",
    "amount": 29.9,
    "change_for": 0,
    "complement": "",
    "type": "OFFLINE"
}
```

**Código:** Cartão de crédito (CRE)\
**Complemento:** vazio\
**Descrição:** Cartão de Crédito\
**SAIPOS:** Crédito (Visa)\
**Pagamento online:** não

```json
{
    "code": "CRE",
    "amount": 29.9,
    "change_for": 0,
    "complement": "",
    "type": "OFFLINE"
}
```

**Código:** Cartão de débito (DEB)\
**Complemento:** vazio\
**Descrição:** Cartão de Débito\
**SAIPOS:** Débito (Visa)\
**Pagamento online:** não

```json
{
    "code": "DEB",
    "amount": 29.9,
    "change_for": 0,
    "complement": "",
    "type": "OFFLINE"
}
```

**Código:** Cartão Genérico (CARD)\
**Complemento:** vazio\
**Descrição:** Cartão Genérico\
**SAIPOS:** Débito (Visa)\
**Pagamento online:** não

```json
{
    "code": "CARD",
    "amount": 29.9,
    "change_for": 0,
    "complement": "",
    "type": "OFFLINE"
}		
```

**Código:** Dinheiro (DIN)\
**Complemento:** vazio\
**Descrição:** Dinheiro\
**SAIPOS:** Dinheiro\
**Pagamento online:** não

O valor enviado em "*change\_for*" será utilizado quando a forma de pagamento for "DIN" (Dinheiro), para informar ao restaurante quanto de troco precisa ser enviado com o motoboy para o recebimento do pagamento.

```json
{
    "code": "DIN",
    "amount": 29.9,
    "change_for": 0,
    "complement": "",
    "type": "OFFLINE"
}
```

**Código:** Pagamento Online (PARTNER\_PAYMENT)\
**Complemento:** pix\
**Descrição:** Pagamento Online via Pix\
**SAIPOS:** Pix (Mastercard)\
**Pagamento online:** sim

```json
{
    "code": "PARTNER_PAYMENT",
    "amount": 29.9,
    "change_for": 0,
    "complement": "pix",
    "type": "ONLINE"
}
```

**Código:** Pagamento Online (PARTNER\_PAYMENT)\
**Complemento:** pix\
**Descrição:** Pagamento Pix na Entrega\
**SAIPOS:** Pix (Mastercard)\
**Pagamento online:** não

```json
{
    "code": "PARTNER_PAYMENT",
    "amount": 29.9,
    "change_for": 0,
    "complement": "pix",
    "type": "OFFLINE"
}
```

**Código:** Pagamento Online (PARTNER\_PAYMENT)\
**Complemento:** vazio\
**Descrição:** Pagamento Online\
**SAIPOS:** Pix online\
**Pagamento online:** sim

```json
{
    "code": "PARTNER_PAYMENT",
    "amount": 29.9,
    "change_for": 0,
    "complement": "",
    "type": "ONLINE"
}
```

> 🚧 Utilizando o complemento!
>
> Caso você opte por enviar um pagamento com complemento, você deve cadastrar na loja em questão esses pagamentos, conforme [documentação](https://saipos-docs-order-api.readme.io/reference/rotinas-pdv).
>
> Por padrão, o pagamento online pix já está cadastrado nas formas de pagamento da loja, porém, caso não integre corretamente, será necessário cadastrá-lo informando o complemento "pix", conforme [documentação](https://saipos-docs-order-api.readme.io/reference/rotinas-pdv).
>
> **Importante:** Caso seja enviado no JSON o campo *complement* com valor diferente do cadastrado no canal de venda na loja Saipos, a forma de pagamento não será reconhecida e irá integrar com a forma de pagamento padrão que normalmente é configurada como "Pagamento não cadastrado".

| Código           | Descrição no sistema Saipos                                 |
| :--------------- | :---------------------------------------------------------- |
| PARTNER\_PAYMENT | Pagamento já realizado na plataforma do parceiro            |
| DIN              | Dinheiro                                                    |
| CARD             | Cartão genérico, quando não especifica se débito ou crédito |
| DEB              | Débito                                                      |
| CRE              | Crédito                                                     |
| VALE             | Vale                                                        |
| OTHER            | Outro                                                       |