# Integração de pagamentos e envios

O checkout online utiliza Mercado Pago Checkout Pro e Melhor Envio por meio de Supabase Edge Functions. Os tokens de pagamento e de frete ficam no servidor; não os coloque em `index.html`, `painel.js` ou no Git.

## Situação e ordem de conclusão

O código do checkout, as Edge Functions, a migração do banco e a conexão OAuth do Melhor Envio já estão preparados neste projeto. O que depende das contas externas é: aplicar a migração e publicar as funções no projeto Supabase, cadastrar os secrets, configurar o Webhook do Mercado Pago, criar/autorizar o usuário administrativo e conectar a conta Melhor Envio. Depois disso, execute os testes de ponta a ponta abaixo.

Siga esta ordem:

1. Preparar e publicar o backend Supabase.
2. Cadastrar os secrets do Supabase usando credenciais de teste.
3. Configurar o Webhook do Mercado Pago.
4. Criar e autorizar o usuário do painel.
5. Conectar o Melhor Envio pelo painel.
6. Preencher medidas dos produtos e executar os testes finais.

## 1. Preparar e publicar o backend

O projeto Supabase configurado no site é `doecoosuqibzdsyadsyg`. Instale o Supabase CLI, autentique-se e, no terminal, execute:

```text
cd "E:\Programacao\programacao\outlet catolico"
supabase login
supabase link --project-ref doecoosuqibzdsyadsyg
supabase db push
```

Confirme que a migração `202611140001_online_checkout.sql` foi aplicada antes de publicar as funções. Depois de cadastrar os secrets da próxima seção, publique:

```text
cd "E:\Programacao\programacao\outlet catolico"
supabase functions deploy quote-shipping
supabase functions deploy create-payment
supabase functions deploy mercadopago-webhook
supabase functions deploy melhor-envio-oauth
supabase functions deploy create-shipping-label
```

O arquivo `supabase/config.toml` desativa a verificação JWT padrão no gateway. As funções públicas validam os dados recebidos e o webhook confere a assinatura do Mercado Pago; as operações do painel validam uma sessão Supabase e uma conta cadastrada em `outlet_admins`. Não publique `SUPABASE_SERVICE_ROLE_KEY` no site nem no repositório.

## 2. Configurar secrets do Supabase

Cadastre os valores abaixo em **Supabase → Edge Functions → Secrets**. Preencha com os dados reais das contas e do site publicado. Não os envie no chat nem os salve nos arquivos do site ou no repositório.

| Secret | Valor |
| --- | --- |
| `MERCADOPAGO_ACCESS_TOKEN` | Access Token de **teste** do vendedor Mercado Pago |
| `MERCADOPAGO_ENVIRONMENT` | `test` durante os testes |
| `MERCADOPAGO_WEBHOOK_SECRET` | Chave secreta de assinatura das notificações Webhook do Mercado Pago |
| `OUTLET_SITE_URL` | URL HTTPS pública do site, sem barra final |
| `OUTLET_SUPPORT_EMAIL` | E-mail de suporte técnico para o cabeçalho exigido pela API Melhor Envio |
| `MELHOR_ENVIO_ENVIRONMENT` | `sandbox` durante os testes |
| `MELHOR_ENVIO_ORIGIN_POSTAL_CODE` | `32673194` |
| `MELHOR_ENVIO_CLIENT_ID` | Client ID do aplicativo Melhor Envio |
| `MELHOR_ENVIO_CLIENT_SECRET` | Client Secret do aplicativo Melhor Envio |
| `MELHOR_ENVIO_REDIRECT_URI` | `https://doecoosuqibzdsyadsyg.supabase.co/functions/v1/melhor-envio-oauth` |
| `MELHOR_ENVIO_FROM_JSON` | JSON com os dados completos do remetente descritos abaixo |

O `MELHOR_ENVIO_FROM_JSON` deve conter os dados reais usados para emitir etiquetas. Exemplo apenas estrutural; substitua os valores e não use os dados fictícios:

```json
{
  "name": "NOME DO REMETENTE",
  "email": "EMAIL DO REMETENTE",
  "phone": "TELEFONE COM DDD",
  "document": "CPF, se pessoa física",
  "company_document": "CNPJ, se pessoa jurídica",
  "state_register": "INSCRIÇÃO ESTADUAL OU ISENTO",
  "address": "Av. Coletora Artur Trindade",
  "number": "1830",
  "complement": "",
  "district": "Alterosas",
  "city": "Betim",
  "postal_code": "32673194",
  "state_abbr": "MG"
}
```

Informe `document` para pessoa física ou `company_document` e `state_register` para pessoa jurídica, conforme o cadastro fiscal do remetente. Não deixe os campos fiscais com valores de exemplo.

## 3. Preparar Mercado Pago em modo de teste

1. Use uma conta de vendedor e credenciais de teste do Mercado Pago.
2. No painel de integrações, configure notificações Webhook para pagamentos. A URL é `https://doecoosuqibzdsyadsyg.supabase.co/functions/v1/mercadopago-webhook`.
3. Copie a chave secreta de assinatura do Webhook para `MERCADOPAGO_WEBHOOK_SECRET`.
4. Configure o Access Token iniciado por `TEST-` em `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_ENVIRONMENT=test`. O checkout só redireciona ao link de sandbox nesse modo; o estoque só é baixado depois de uma notificação assinada e de uma consulta do pagamento ao Mercado Pago.

Os endereços de retorno são montados a partir de `OUTLET_SITE_URL`. Eles mostram ao comprador o resultado do redirecionamento, mas não substituem a confirmação do Webhook.

## 4. Criar acesso administrativo e conectar Melhor Envio em Sandbox

1. Crie/convide a conta administrativa em **Supabase → Authentication → Users** e confirme que o usuário consegue entrar no painel.
2. Cadastre o UUID desse usuário como administrador:

```sql
insert into public.outlet_admins (user_id)
values ('UUID-DO-USUARIO-AUTORIZADO');
```

3. Crie uma conta separada no [Sandbox do Melhor Envio](https://sandbox.melhorenvio.com.br/) e um aplicativo em sua Área Dev.
4. Cadastre como callback exatamente o valor de `MELHOR_ENVIO_REDIRECT_URI` e configure os secrets Client ID e Client Secret.
5. Entre na aba **Relatório de Vendas** do painel e use **Conectar Melhor Envio**. A autorização fica armazenada no Supabase e solicita apenas as permissões de cotação, criação de frete, checkout, geração e impressão de etiquetas.
6. Preencha peso e dimensões dos produtos no cadastro do painel. Produtos sem essas informações não podem receber cotação.

O fluxo do painel compra o frete usando o saldo da carteira Melhor Envio, gera a etiqueta e mostra um link privado de impressão (o usuário precisa estar conectado à mesma conta Melhor Envio). O botão exige confirmação antes de consumir saldo e uma chave NF-e de 44 dígitos. Em produção, use dados fiscais válidos e confirme as regras de emissão aplicáveis à empresa.

## 5. Teste antes de produção

Use somente as contas de teste/Sandbox nesta etapa e confira cada item:

- [ ] A loja calcula frete para um CEP válido e exibe serviços disponíveis.
- [ ] O pagamento cria uma preferência e abre o Checkout Pro de teste.
- [ ] O pedido aparece no **Relatório de Vendas** com status pendente.
- [ ] O Webhook assinado atualiza o pedido; pagamentos em análise/recusados não baixam estoque e um pagamento aprovado baixa o estoque uma única vez.
- [ ] A conta administrativa conecta o Melhor Envio e consegue cotar e continuar a geração de etiqueta em Sandbox.
- [ ] Remetente, dados fiscais e dimensões dos produtos estão válidos; a etiqueta só deve ser comprada no ambiente de teste, pois a operação pode consumir saldo.

Não mude para produção até validar credenciais, callback, endereço do remetente, dados fiscais, saldo e recebimento do Webhook.

Para produção, troque para as credenciais de produção do Mercado Pago e configure `MERCADOPAGO_ENVIRONMENT=production`. Use também um aplicativo/conta Melhor Envio de produção, configure os secrets e autorize novamente a conta. Os ambientes de teste e produção do Melhor Envio são separados.
