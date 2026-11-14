const SUPABASE_URL = "https://doecoosuqibzdsyadsyg.supabase.co";
        const SUPABASE_KEY = "sb_publishable_-30z4xAhwJPYmy1bfSEjCw_loKUe8uL";
        const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

        let todosProdutos = [];
        let todasVendas = [];
        let todasConsignacoes = [];
        let todosCustos = [];
        let filtroTipoCustoAtual = 'todos';
        let listaCaixa = [];
        let totalCaixa = 0;
        let pedidosOnline = [];
        let sessaoAdmin = null;

        let chartPagamentoInstance = null;
        let chartStatusInstance = null;
        let chartEstoqueBaixoInstance = null;
        let chartResumoEstoqueInstance = null;
        let chartCustosAnoInstance = null;

        let produtosEsgotados = [];
        let produtosEstoqueBaixo = [];
        let produtosEstoqueNormal = [];
        let alertaVencimentoJaAvisado = false;
        const DIAS_ALERTA_VENCIMENTO = 5;

        /* ======= PROMOÇÕES: preço vigente (volta ao original sozinho após a data final) ======= */
        function hojeISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
        function emPromocao(p) { return p.preco_promocional != null && Number(p.preco_promocional) > 0 && !!p.promocao_fim && p.promocao_fim >= hojeISO(); }
        function precoVigente(p) { return emPromocao(p) ? Number(p.preco_promocional) : Number(p.preco || 0); }
        function formatarDataBR(iso) { return iso ? iso.split('-').reverse().join('/') : '-'; }

        document.addEventListener("DOMContentLoaded", function() {
            const dataAtual = new Date().toISOString().slice(0, 7);
            const filtroMes = document.getElementById('filtro-mes-custos');
            const inputMesCusto = document.getElementById('custo-mes');
            if(filtroMes) filtroMes.value = dataAtual;
            if(inputMesCusto) inputMesCusto.value = dataAtual;
            
            document.getElementById('consig-data-retirada').value = new Date().toISOString().split('T')[0];

            carregarBanco();
            carregarVendas();
            carregarConsignacoes();
            carregarCustosDespesas();
            inicializarAcessoAdmin();
        });

        function mostrarMensagem(texto, tipo = 'success') {
            const container = document.getElementById('toast-container');
            let icon = '<i class="fa-solid fa-circle-check" style="color:var(--success-green); font-size:1.2rem;"></i>';
            if(tipo === 'error') icon = '<i class="fa-solid fa-circle-xmark" style="color:var(--danger-red); font-size:1.2rem;"></i>';
            if(tipo === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning-yellow); font-size:1.2rem;"></i>';

            const toast = document.createElement('div');
            toast.className = `toast ${tipo}`;
            toast.innerHTML = `${icon} <span style="flex:1;">${texto}</span>`;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        async function inicializarAcessoAdmin() {
            const params = new URLSearchParams(window.location.search);
            if(params.get('melhor_envio') === 'connected') {
                mostrarMensagem('Conta Melhor Envio conectada com sucesso.');
                params.delete('melhor_envio');
                const query = params.toString();
                history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
            }

            _supabase.auth.onAuthStateChange((_event, session) => {
                sessaoAdmin = session;
                atualizarControlesAdmin();
                if(session) carregarPedidosOnline();
                else {
                    pedidosOnline = [];
                    renderizarPedidosOnline();
                }
            });

            const { data, error } = await _supabase.auth.getSession();
            if(error) {
                document.getElementById('online-orders-message').textContent = 'Erro ao verificar a sessão: ' + error.message;
                return;
            }
            sessaoAdmin = data.session;
            atualizarControlesAdmin();
            if(sessaoAdmin) await carregarPedidosOnline();
        }

        function atualizarControlesAdmin() {
            const logIn = document.getElementById('admin-login-form');
            const controls = document.getElementById('admin-session-controls');
            logIn.style.display = sessaoAdmin ? 'none' : 'flex';
            controls.style.display = sessaoAdmin ? 'flex' : 'none';
            document.getElementById('admin-session-label').textContent = sessaoAdmin
                ? `Conectado como ${sessaoAdmin.user.email || 'administrador'}`
                : '';
        }

        async function mensagemErroFuncao(data, error) {
            if(data && data.error) return data.error;
            if(error && error.context && typeof error.context.clone === 'function') {
                try {
                    const resposta = await error.context.clone().json();
                    if(resposta && resposta.error) return resposta.error;
                } catch(parseError) {
                    console.warn('Não foi possível interpretar o erro retornado pela função:', parseError);
                }
            }
            return error && error.message ? error.message : 'Erro inesperado na integração.';
        }

        async function entrarPainelAdmin(event) {
            event.preventDefault();
            const { data, error } = await _supabase.auth.signInWithPassword({
                email: document.getElementById('admin-email').value.trim(),
                password: document.getElementById('admin-password').value
            });
            if(error) {
                mostrarMensagem('Não foi possível entrar: ' + error.message, 'error');
                return;
            }
            sessaoAdmin = data.session;
            atualizarControlesAdmin();
            await carregarPedidosOnline();
        }

        async function sairPainelAdmin() {
            const { error } = await _supabase.auth.signOut();
            if(error) {
                mostrarMensagem('Erro ao sair: ' + error.message, 'error');
                return;
            }
            sessaoAdmin = null;
            pedidosOnline = [];
            atualizarControlesAdmin();
            renderizarPedidosOnline();
        }

        async function carregarPedidosOnline() {
            const mensagem = document.getElementById('online-orders-message');
            const body = document.getElementById('online-orders-body');
            if(!sessaoAdmin) {
                mensagem.textContent = 'Entre com uma conta autorizada para consultar pedidos e etiquetas.';
                return;
            }

            mensagem.textContent = 'Carregando pedidos online...';
            const { data, error } = await _supabase
                .from('outlet_pedidos_online')
                .select('id,created_at,cliente_nome,cliente_telefone,endereco_entrega,itens,total,frete_escolhido,status,payment_status,shipping_status,label_url')
                .order('created_at', { ascending: false });
            if(error) {
                pedidosOnline = [];
                body.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#842029; padding:16px;">Não foi possível consultar os pedidos. Verifique a autorização administrativa e a migração do banco.</td></tr>';
                mensagem.textContent = error.message;
                return;
            }
            pedidosOnline = data || [];
            mensagem.textContent = pedidosOnline.length
                ? `${pedidosOnline.length} pedido(s) online.`
                : 'Nenhum pedido online registrado.';
            renderizarPedidosOnline();
        }

        function renderizarPedidosOnline() {
            const body = document.getElementById('online-orders-body');
            if(!body) return;
            if(!sessaoAdmin) {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:16px;">Aguardando acesso administrativo.</td></tr>';
                return;
            }
            if(pedidosOnline.length === 0) {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:16px;">Nenhum pedido online registrado.</td></tr>';
                return;
            }

            body.replaceChildren();
            pedidosOnline.forEach(pedido => {
                const row = document.createElement('tr');
                const date = pedido.created_at ? new Date(pedido.created_at).toLocaleString('pt-BR') : '-';
                const items = Array.isArray(pedido.itens) ? pedido.itens : [];
                const address = pedido.endereco_entrega || {};
                const addressText = [
                    address.address,
                    address.number,
                    address.district,
                    address.city,
                    address.state_abbr,
                    address.postal_code
                ].filter(Boolean).join(', ');
                const shipping = pedido.frete_escolhido || {};
                const status = String(pedido.status || 'pending_payment');
                const shippingStatus = String(pedido.shipping_status || 'not_started');
                const statusLabels = {
                    pending_payment: `Aguardando pagamento (${pedido.payment_status || 'pendente'})`,
                    paid: 'Pago',
                    paid_inventory_conflict: 'Pago — revisar estoque',
                    payment_rejected: 'Pagamento recusado',
                    payment_cancelled: 'Pagamento cancelado',
                    checkout_error: 'Erro ao iniciar pagamento'
                };
                const shippingLabels = {
                    not_started: 'Etiqueta não criada',
                    in_cart: 'Frete no carrinho Melhor Envio',
                    purchased: 'Frete pago; etiqueta pendente',
                    generated: 'Etiqueta gerada'
                };
                const appendCell = (text) => {
                    const cell = document.createElement('td');
                    cell.textContent = text;
                    row.appendChild(cell);
                    return cell;
                };

                const dateCell = appendCell(`${date}\n${pedido.id}`);
                dateCell.style.whiteSpace = 'pre-line';
                const customerCell = appendCell(`${pedido.cliente_nome || 'Cliente'} · ${pedido.cliente_telefone || ''}\n${addressText}`);
                customerCell.style.whiteSpace = 'pre-line';
                appendCell(items.map(item => `${item.quantity || 1}x ${item.nome || 'Produto'}`).join('; '));
                appendCell(formatarValor(Number(pedido.total || 0)));
                appendCell(`${statusLabels[status] || status} · Mercado Pago`);
                appendCell(`${shipping.company_name || shipping.company || 'Frete'} — ${shippingLabels[shippingStatus] || shippingStatus}`);

                const actionCell = document.createElement('td');
                if(pedido.label_url) {
                    const link = document.createElement('a');
                    link.href = pedido.label_url;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = 'Abrir etiqueta';
                    actionCell.appendChild(link);
                } else if(status === 'paid' && !['paid_inventory_conflict'].includes(status)) {
                    const invoice = document.createElement('input');
                    invoice.type = 'text';
                    invoice.inputMode = 'numeric';
                    invoice.maxLength = 44;
                    invoice.placeholder = 'Chave NF-e (44 dígitos)';
                    invoice.setAttribute('aria-label', `Chave NF-e do pedido ${pedido.id}`);
                    invoice.style.cssText = 'width:190px; padding:7px; border:1px solid #CCC; border-radius:5px; margin-right:5px;';
                    actionCell.appendChild(invoice);

                    const button = document.createElement('button');
                    button.className = 'btn-primary';
                    button.type = 'button';
                    button.textContent = shippingStatus === 'not_started' ? 'Comprar e gerar etiqueta' : 'Continuar etiqueta';
                    button.addEventListener('click', () => gerarEtiquetaPedido(pedido.id, invoice.value, button));
                    actionCell.appendChild(button);
                } else {
                    actionCell.textContent = 'Disponível após pagamento';
                }
                row.appendChild(actionCell);
                body.appendChild(row);
            });
        }

        function formatarValor(valor) {
            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
        }

        async function conectarMelhorEnvio() {
            const { data, error } = await _supabase.functions.invoke('melhor-envio-oauth', {
                body: { action: 'authorize' }
            });
            if(error || !data || !data.authorize_url) {
                mostrarMensagem(error ? await mensagemErroFuncao(data, error) : 'Não foi possível iniciar a conexão do Melhor Envio.', 'error');
                return;
            }
            window.location.assign(data.authorize_url);
        }

        async function gerarEtiquetaPedido(orderId, invoiceKey, button) {
            const pedido = pedidosOnline.find(item => String(item.id) === String(orderId));
            if(!pedido) return;
            const mensagem = pedido.shipping_status === 'not_started'
                ? 'O Melhor Envio usará saldo da carteira para comprar este frete e gerar a etiqueta. Deseja continuar?'
                : 'Deseja continuar o fluxo da etiqueta pendente?';
            if(!window.confirm(mensagem)) return;

            button.disabled = true;
            button.textContent = 'Processando...';
            const { data, error } = await _supabase.functions.invoke('create-shipping-label', {
                body: { order_id: orderId, invoice_key: invoiceKey }
            });
            if(error || !data || data.error) {
                mostrarMensagem(error ? await mensagemErroFuncao(data, error) : (data && data.error ? data.error : 'Falha ao criar a etiqueta.'), 'error');
                button.disabled = false;
                button.textContent = pedido.shipping_status === 'not_started' ? 'Comprar e gerar etiqueta' : 'Continuar etiqueta';
                await carregarPedidosOnline();
                return;
            }
            mostrarMensagem('Etiqueta gerada com sucesso.');
            await carregarPedidosOnline();
        }

        function trocarAba(aba, btn) {
            document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
            document.getElementById('aba-' + aba).classList.add('active');
            if(btn) btn.classList.add('active');

            if(aba === 'vendas') setTimeout(renderizarGraficosVendas, 100);
            else if(aba === 'estoque') setTimeout(renderizarGraficosEstoque, 100);
            else if(aba === 'consignados') carregarConsignacoes();
            else if(aba === 'fornecedores') setTimeout(renderizarGraficoCustosAno, 100);
            else if(aba === 'promocoes') renderizarPromocoes();
        }

        async function carregarBanco() {
            try {
                var response = await _supabase.from('outlet_produtos').select('*');
                todosProdutos = response.data || [];
                renderizarEstoque(todosProdutos);
                renderizarPDV(todosProdutos);
                renderizarGraficosEstoque();
                renderizarPromocoes();
                atualizarAvisoMedidas();
            } catch (err) { console.error(err); }
        }

        /* ======= MÓDULO DE CONSIGNAÇÃO ======= */
        function abrirModalConsignacao() {
            if(listaCaixa.length === 0) {
                mostrarMensagem('Adicione itens ao caixa antes de gerar uma consignação.', 'warning');
                return;
            }
            
            let htmlResumo = listaCaixa.map(it => `<div>${it.qtd}x ${it.nome} (R$ ${it.preco.toFixed(2).replace('.',',')})</div>`).join('');
            document.getElementById('consig-resumo-itens').innerHTML = htmlResumo;
            document.getElementById('consig-total-valor').textContent = `Total Estimado: R$ ${totalCaixa.toFixed(2).replace('.',',')}`;
            
            document.getElementById('modal-consignacao').classList.add('active');
        }

        function fecharModalConsignacao() {
            document.getElementById('modal-consignacao').classList.remove('active');
        }

        async function finalizarConsignacao(e) {
            e.preventDefault();
            
            const payload = {
                responsavel: document.getElementById('consig-nome').value,
                cpf: document.getElementById('consig-cpf').value,
                endereco_residencial: document.getElementById('consig-endereco').value,
                telefone: document.getElementById('consig-telefone').value,
                segundo_contato: document.getElementById('consig-contato-secundario').value,
                paroquia: document.getElementById('consig-paroquia').value,
                evento: document.getElementById('consig-evento').value,
                data_retirada: document.getElementById('consig-data-retirada').value,
                data_acerto: document.getElementById('consig-data-acerto').value,
                itens: JSON.stringify(listaCaixa),
                total_estimado: totalCaixa,
                status: 'Pendente'
            };

            try {
                const resConsig = await _supabase.from('outlet_consignacoes').insert([payload]);
                if(resConsig.error) throw resConsig.error;

                let contagemItens = {};
                listaCaixa.forEach(item => { contagemItens[item.id] = (contagemItens[item.id] || 0) + item.qtd; });

                for (let id in contagemItens) {
                    let prodOriginal = todosProdutos.find(p => String(p.id) === String(id));
                    if(prodOriginal) {
                        let novoEstoque = Math.max(0, (prodOriginal.estoque || 0) - contagemItens[id]);
                        await _supabase.from('outlet_produtos').update({ estoque: novoEstoque }).eq('id', id);
                    }
                }

                mostrarMensagem('Consignação registrada com sucesso!');
                gerarReciboConsignacao(payload, listaCaixa);

                fecharModalConsignacao();
                document.getElementById('form-consignacao').reset();
                document.getElementById('consig-data-retirada').value = new Date().toISOString().split('T')[0];
                
                listaCaixa = [];
                totalCaixa = 0;
                atualizarVisorCaixa();
                
                await carregarBanco();
                await carregarConsignacoes();

            } catch (err) {
                mostrarMensagem('Erro ao salvar consignado. Certifique-se de executar no SQL Editor: ALTER TABLE outlet_consignacoes DISABLE ROW LEVEL SECURITY;', 'error');
            }
        }

        async function carregarConsignacoes() {
            try {
                const { data, error } = await _supabase.from('outlet_consignacoes').select('*').order('created_at', { ascending: false });
                if(error) throw error;
                todasConsignacoes = data || [];
                renderizarConsignacoes(todasConsignacoes);
            } catch(err) {
                console.error("Erro ao carregar consignações:", err);
            }
        }

        function renderizarConsignacoes(lista) {
            const tbody = document.getElementById('erp-consignados-body');
            if(!tbody) return;

            if(!lista || lista.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888; padding:20px;">Nenhuma consignação registrada.</td></tr>';
                return;
            }

            tbody.innerHTML = lista.map(c => {
                let itensParsed = [];
                try { itensParsed = typeof c.itens === 'string' ? JSON.parse(c.itens) : c.itens; } catch(e) { itensParsed = []; }
                
                let itensStr = Array.isArray(itensParsed) 
                    ? itensParsed.map(it => `${it.qtd || 1}x ${it.nome || 'Produto'} (R$ ${Number(it.preco || 0).toFixed(2)})`).join('<br>') 
                    : 'Detalhes indisponíveis';

                let dataRet = c.data_retirada ? c.data_retirada.split('-').reverse().join('/') : '-';
                let dataAcerto = c.data_acerto ? c.data_acerto.split('-').reverse().join('/') : '-';
                let status = c.status || 'Pendente';
                let badgeClass = status.toLowerCase() === 'concluído' || status.toLowerCase() === 'acertado' ? 'status-confirmado' : 'status-pendente';

                let acoesBtn = status.toLowerCase() === 'pendente' || status.toLowerCase() === 'aberto'
                    ? `<button class="btn-success" onclick="abrirModalAcerto('${c.id}')"><i class="fa-solid fa-check"></i> Fazer Acerto</button>`
                    : `<span style="font-size:0.75rem; color:#666;">Acertado</span>`;

                return `
                    <tr>
                        <td style="font-size:0.8rem; color:#555;"><strong>Retirada:</strong> ${dataRet}<br><strong>Devolução:</strong> <span style="color:var(--brand-burgundy); font-weight:bold;">${dataAcerto}</span></td>
                        <td><strong>${c.responsavel}</strong><br><span style="font-size:0.75rem; color:#666;">${c.paroquia || c.evento || '-'} (${c.telefone || ''})</span></td>
                        <td style="font-size:0.8rem;">${itensStr}</td>
                        <td style="font-weight:bold; color:var(--brand-burgundy);">R$ ${Number(c.total_estimado || 0).toFixed(2).replace('.',',')}</td>
                        <td><span class="badge-status ${badgeClass}">${status}</span></td>
                        <td>${acoesBtn}</td>
                    </tr>
                `;
            }).join('');
        }

        function filtrarConsignados() {
            let termo = document.getElementById('consignados-search').value.toLowerCase();
            let filtrados = todasConsignacoes.filter(c => 
                (c.responsavel || '').toLowerCase().includes(termo) || 
                (c.paroquia || '').toLowerCase().includes(termo) || 
                (c.evento || '').toLowerCase().includes(termo)
            );
            renderizarConsignacoes(filtrados);
        }

        function abrirModalAcerto(id) {
            let consig = todasConsignacoes.find(c => String(c.id) === String(id));
            if(!consig) return;

            document.getElementById('acerto-consig-id').value = consig.id;
            document.getElementById('acerto-info-responsavel').innerHTML = `<strong>Responsável:</strong> ${consig.responsavel} | <strong>Devolução Prevista:</strong> ${consig.data_acerto ? consig.data_acerto.split('-').reverse().join('/') : '-'}`;

            let itensParsed = [];
            try { itensParsed = typeof consig.itens === 'string' ? JSON.parse(consig.itens) : consig.itens; } catch(e) { itensParsed = []; }

            let tbody = document.getElementById('tbody-acerto-itens');
            tbody.innerHTML = itensParsed.map((it, idx) => `
                <tr data-id="${it.id}" data-preco="${it.preco}" data-max="${it.qtd}">
                    <td style="font-weight:600; font-size:0.85rem;">${it.nome}</td>
                    <td style="text-align:center;">${it.qtd} un</td>
                    <td><input type="number" class="input-qtd-vendida" min="0" max="${it.qtd}" value="${it.qtd}" style="width:70px; padding:6px; text-align:center;" oninput="calcularTotalAcerto()"></td>
                    <td style="text-align:center; font-weight:bold; color:var(--danger-red);" class="td-devolvido">0 un</td>
                </tr>
            `).join('');

            calcularTotalAcerto();
            document.getElementById('modal-acerto-consignado').classList.add('active');
        }

        function fecharModalAcerto() {
            document.getElementById('modal-acerto-consignado').classList.remove('active');
        }

        function calcularTotalAcerto() {
            let linhas = document.querySelectorAll('#tbody-acerto-itens tr');
            let totalGeral = 0;

            linhas.forEach(tr => {
                let preco = Number(tr.getAttribute('data-preco'));
                let max = Number(tr.getAttribute('data-max'));
                let inputVendida = tr.querySelector('.input-qtd-vendida');
                let tdDevolvido = tr.querySelector('.td-devolvido');

                let vendida = Number(inputVendida.value);
                if(vendida > max) { vendida = max; inputVendida.value = max; }
                if(vendida < 0) { vendida = 0; inputVendida.value = 0; }

                let devolvido = max - vendida;
                tdDevolvido.textContent = `${devolvido} un`;

                totalGeral += (vendida * preco);
            });

            document.getElementById('acerto-total-calculado').textContent = `R$ ${totalGeral.toFixed(2).replace('.',',')}`;
        }

        async function confirmarFechamentoAcerto() {
            let idConsig = document.getElementById('acerto-consig-id').value;
            let consigOriginal = todasConsignacoes.find(c => String(c.id) === String(idConsig));
            if(!consigOriginal) return;

            let itensParsed = [];
            try { itensParsed = typeof consigOriginal.itens === 'string' ? JSON.parse(consigOriginal.itens) : consigOriginal.itens; } catch(e) { itensParsed = []; }

            let linhas = document.querySelectorAll('#tbody-acerto-itens tr');
            let novosItensVendidos = [];
            let totalEfetivoVendido = 0;

            linhas.forEach((tr, index) => {
                let itemOrig = itensParsed[index];
                let vendida = Number(tr.querySelector('.input-qtd-vendida').value);
                let devolvido = itemOrig.qtd - vendida;

                if(vendida > 0) {
                    novosItensVendidos.push({
                        id: itemOrig.id,
                        nome: itemOrig.nome,
                        preco: itemOrig.preco,
                        qtd: vendida
                    });
                    totalEfetivoVendido += (vendida * itemOrig.preco);
                }

                if(devolvido > 0) {
                    let prod = todosProdutos.find(p => String(p.id) === String(itemOrig.id));
                    if(prod) {
                        let novoEstoque = Number(prod.estoque || 0) + devolvido;
                        _supabase.from('outlet_produtos').update({ estoque: novoEstoque }).eq('id', itemOrig.id);
                    }
                }
            });

            let formaPgto = document.getElementById('acerto-forma-pagamento').value;

            try {
                await _supabase.from('outlet_consignacoes').update({
                    status: 'Concluído',
                    total_estimado: totalEfetivoVendido
                }).eq('id', idConsig);

                if(novosItensVendidos.length > 0) {
                    await _supabase.from('outlet_vendas').insert([{
                        cliente_nome: `Consignado - ${consigOriginal.responsavel}`,
                        cliente_telefone: consigOriginal.telefone || '',
                        itens: JSON.stringify(novosItensVendidos),
                        total: totalEfetivoVendido,
                        status: 'Confirmado',
                        forma_pagamento: formaPgto
                    }]);
                }

                mostrarMensagem('Acerto de consignado concluído com sucesso!');
                fecharModalAcerto();

                await carregarBanco();
                await carregarConsignacoes();
                await carregarVendas();

            } catch(err) {
                mostrarMensagem('Erro ao fechar acerto: ' + err.message, 'error');
            }
        }

        function gerarReciboConsignacao(payload, lista) {
            const janela = window.open('', '', 'width=800,height=600');
            let htmlItens = lista.map((it, index) => `
                <tr>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${index + 1}</td>
                    <td style="border: 1px solid #000; padding: 5px;">${it.nome}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${it.qtd}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: right;">R$ ${it.preco.toFixed(2).replace('.',',')}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: right;">R$ ${(it.preco * it.qtd).toFixed(2).replace('.',',')}</td>
                </tr>
            `).join('');

            let html = `
                <html>
                <head>
                    <title>Ficha de Consignação - Outlet Católico</title>
                    <style>
                        body { font-family: Arial, sans-serif; font-size: 12px; color: #000; padding: 20px; }
                        h2 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
                        .info-box { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                        .info-box td { border: 1px solid #000; padding: 6px; }
                        .table-itens { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        .table-itens th, .table-itens td { border: 1px solid #000; padding: 6px; }
                        .table-itens th { background-color: #f0f0f0; }
                    </style>
                </${'head'}>
                <body>
                    <h2>FOLHA DE CONTROLE DE MERCADORIAS EM CONSIGNAÇÃO</h2>
                    <table class="info-box">
                        <tr>
                            <td><strong>Responsável:</strong> ${payload.responsavel}</td>
                            <td><strong>CPF:</strong> ${payload.cpf || ''}</td>
                            <td><strong>Telefone:</strong> ${payload.telefone}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Endereço Residencial:</strong> ${payload.endereco_residencial || ''}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Paróquia:</strong> ${payload.paroquia || ''}</td>
                            <td><strong>Evento:</strong> ${payload.evento || ''}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Data da Retirada:</strong> ${payload.data_retirada.split('-').reverse().join('/')}</td>
                            <td><strong>Data Prevista p/ Acerto:</strong> ${payload.data_acerto.split('-').reverse().join('/')}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Segundo Contato:</strong> ${payload.segundo_contato || ''}</td>
                        </tr>
                    </table>

                    <h3 style="margin-top:20px; text-transform:uppercase;">1. Produtos Entregues em Consignação</h3>
                    <table class="table-itens">
                        <thead>
                            <tr><th>Nº</th><th>PRODUTO</th><th>QTD</th><th>VALOR UNIT.</th><th>VALOR TOTAL</th></tr>
                        </thead>
                        <tbody>${htmlItens}</tbody>
                        <tfoot>
                            <tr>
                                <td colspan="4" style="text-align: right; font-weight: bold; padding:8px;">TOTAL ESTIMADO:</td>
                                <td style="text-align: right; font-weight: bold; padding:8px;">R$ ${payload.total_estimado.toFixed(2).replace('.',',')}</td>
                            </tr>
                        </tfoot>
                    </table>
                    
                    <div style="margin-top: 60px; text-align: center;">
                        <p>_________________________________________________________</p>
                        <p>Assinatura do Responsável</p>
                    </div>
                    
                    <${'script'}>
                        window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }
                    </${'script'}>
                </${'body'}>
                </${'html'}>
            `;
            janela.document.write(html);
            janela.document.close();
        }

        function renderizarGraficosEstoque() {
            let produtosBaixos = [...todosProdutos]
                .filter(p => Number(p.estoque || 0) <= 3)
                .sort((a, b) => Number(a.estoque || 0) - Number(b.estoque || 0))
                .slice(0, 6);
            
            const ctxEstBaixo = document.getElementById('chartEstoqueBaixo').getContext('2d');
            if(chartEstoqueBaixoInstance) chartEstoqueBaixoInstance.destroy();

            chartEstoqueBaixoInstance = new Chart(ctxEstBaixo, {
                type: 'bar',
                data: {
                    labels: produtosBaixos.map(p => (p.nome || '').substring(0, 20) + ((p.nome || '').length > 20 ? '...' : '')),
                    datasets: [{
                        label: 'Estoque Atual (un)',
                        data: produtosBaixos.map(p => Number(p.estoque || 0)),
                        backgroundColor: produtosBaixos.map(p => Number(p.estoque || 0) <= 0 ? '#dc3545' : '#C09A53'),
                        borderRadius: 4
                    }]
                },
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { 
                        x: { beginAtZero: true, min: 0, suggestedMax: 5, ticks: { stepSize: 1 } },
                        y: { ticks: { font: { size: 10 } } }
                    }, 
                    plugins: { legend: { display: false } } 
                }
            });

            produtosEsgotados = [];
            produtosEstoqueBaixo = [];
            produtosEstoqueNormal = [];

            todosProdutos.forEach(p => {
                let est = Number(p.estoque || 0);
                if(est <= 0) produtosEsgotados.push(p);
                else if(est <= 3) produtosEstoqueBaixo.push(p);
                else produtosEstoqueNormal.push(p);
            });

            const ctxResumo = document.getElementById('chartResumoEstoque').getContext('2d');
            if(chartResumoEstoqueInstance) chartResumoEstoqueInstance.destroy();

            chartResumoEstoqueInstance = new Chart(ctxResumo, {
                type: 'doughnut',
                data: {
                    labels: [`Esgotados (${produtosEsgotados.length})`, `Estoque Baixo (${produtosEstoqueBaixo.length})`, `Normal (${produtosEstoqueNormal.length})`],
                    datasets: [{
                        data: [produtosEsgotados.length, produtosEstoqueBaixo.length, produtosEstoqueNormal.length],
                        backgroundColor: ['#dc3545', '#ffc107', '#198754']
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
                    onClick: (e, activeEls) => {
                        if (activeEls.length > 0) { mostrarListaDoughnut(activeEls[0].index); }
                    }
                }
            });
        }

        function mostrarListaDoughnut(index) {
            document.getElementById('view-chart-doughnut').style.display = 'none';
            document.getElementById('view-list-doughnut').style.display = 'flex';
            
            let titulo = '';
            let cor = '';
            let lista = [];

            if (index === 0) { titulo = 'Produtos Esgotados'; cor = 'var(--danger-red)'; lista = produtosEsgotados; }
            else if (index === 1) { titulo = 'Estoque Baixo (1 a 3)'; cor = 'var(--warning-yellow)'; lista = produtosEstoqueBaixo; }
            else if (index === 2) { titulo = 'Estoque Normal (>3)'; cor = 'var(--success-green)'; lista = produtosEstoqueNormal; }

            document.getElementById('titulo-lista-doughnut').innerHTML = `<span style="color:${cor};"><i class="fa-solid fa-box"></i> ${titulo}</span>`;
            
            const tbody = document.getElementById('tbody-lista-doughnut');
            if(lista.length === 0) {
                tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#888; font-size:0.8rem;">Nenhum produto nesta categoria.</td></tr>`;
            } else {
                tbody.innerHTML = lista.map(p => `
                    <tr>
                        <td style="font-size:0.8rem; font-weight:600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;" title="${p.nome}">${p.nome}</td>
                        <td style="font-weight:bold; color:${cor};">${p.estoque} un</td>
                    </tr>
                `).join('');
            }
        }

        function voltarGraficoDoughnut() {
            document.getElementById('view-list-doughnut').style.display = 'none';
            document.getElementById('view-chart-doughnut').style.display = 'flex';
        }

        function renderizarPDV(lista) {
            const tbody = document.getElementById('pdv-table-body');
            if(!tbody) return;
            tbody.innerHTML = lista.map(p => {
                const semEstoque = (p.estoque || 0) <= 0;
                const nomeSeguro = (p.nome || '').replace(/'/g, "'");
                return `<tr>
                    <td style="font-size:0.8rem; color:#666;">${p.sku || '-'}</td>
                    <td style="font-weight:600; font-size: 0.85rem;">${p.nome}</td>
                    <td>${p.estoque || 0} un</td>
                    <td style="color:var(--brand-burgundy); font-weight:bold;">${emPromocao(p) ? `<span style="text-decoration:line-through; color:#999; font-weight:400; font-size:0.75rem;">R$ ${Number(p.preco || 0).toFixed(2).replace('.', ',')}</span><br>` : ''}R$ ${precoVigente(p).toFixed(2).replace('.', ',')}</td>
                    <td><button class="btn-secundary" style="padding: 4px 8px; font-size:0.75rem;" onclick="addCaixa('${p.id}', '${nomeSeguro}', ${precoVigente(p)})" ${semEstoque ? 'disabled style="opacity:0.5;"' : ''}>+ Add</button></td>
                </tr>`;
            }).join('');
        }

        function filtrarPDV() {
            var termo = document.getElementById('pdv-search').value.toLowerCase();
            var filtrados = todosProdutos.filter(p => (p.nome || '').toLowerCase().includes(termo) || (p.sku || '').toLowerCase().includes(termo));
            renderizarPDV(filtrados);
        }

        function addCaixa(id, nome, preco) {
            let index = listaCaixa.findIndex(it => it.id === id);
            if(index > -1) { listaCaixa[index].qtd++; } 
            else { listaCaixa.push({ id: id, nome: nome, preco: Number(preco), qtd: 1 }); }
            totalCaixa += Number(preco);
            atualizarVisorCaixa();
        }
        
        function removerDoCaixa(id, preco) {
            let index = listaCaixa.findIndex(it => it.id === id);
            if(index > -1) {
                totalCaixa -= Number(preco);
                if(listaCaixa[index].qtd > 1) { listaCaixa[index].qtd--; }
                else { listaCaixa.splice(index, 1); }
                atualizarVisorCaixa();
            }
        }

        function atualizarVisorCaixa() {
            document.getElementById('total-caixa').textContent = 'R$ ' + Math.max(0, totalCaixa).toFixed(2).replace('.',',');
            if(listaCaixa.length === 0) {
                document.getElementById('itens-caixa').innerHTML = 'Caixa livre.';
                return;
            }
            document.getElementById('itens-caixa').innerHTML = listaCaixa.map(item => `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed #CCC; padding:5px 0;">
                    <div style="flex:1;"><span style="font-weight:bold; color:var(--brand-burgundy); margin-right:5px;">${item.qtd}x</span> ${item.nome}</div>
                    <div style="display:flex; gap: 10px; align-items:center;">
                        <strong>R$ ${(item.preco * item.qtd).toFixed(2).replace('.', ',')}</strong>
                        <button onclick="removerDoCaixa('${item.id}', ${item.preco})" style="background:none; border:none; color:red; cursor:pointer;"><i class="fa-solid fa-minus-circle"></i></button>
                    </div>
                </div>
            `).join('');
        }

        async function finalizarVendaPDV() {
            if(listaCaixa.length === 0) { mostrarMensagem('O caixa está vazio.', 'warning'); return; }
            var formaPgto = document.getElementById('forma-pagamento').value;
            try {
                let contagemItens = {};
                listaCaixa.forEach(item => { contagemItens[item.id] = (contagemItens[item.id] || 0) + item.qtd; });

                for (let id in contagemItens) {
                    let prodOriginal = todosProdutos.find(p => String(p.id) === String(id));
                    if(prodOriginal) {
                        let novoEstoque = Math.max(0, (prodOriginal.estoque || 0) - contagemItens[id]);
                        await _supabase.from('outlet_produtos').update({ estoque: novoEstoque }).eq('id', id);
                    }
                }

                await _supabase.from('outlet_vendas').insert([{
                    cliente_nome: 'Balcão (PDV)',
                    itens: JSON.stringify(listaCaixa),
                    total: totalCaixa,
                    status: 'Confirmado',
                    forma_pagamento: formaPgto
                }]);

                mostrarMensagem('Venda PDV realizada com sucesso e estoque atualizado!');
                listaCaixa = [];
                totalCaixa = 0;
                atualizarVisorCaixa();
                await carregarBanco();
                await carregarVendas();
            } catch (err) { mostrarMensagem('Erro ao finalizar venda: ' + err.message, 'error'); }
        }

        function abrirModalProduto(id) {
            id = id || null;
            var form = document.getElementById('form-produto');
            form.reset();
            if (id) {
                document.getElementById('modal-title').textContent = 'Editar Produto';
                var p = todosProdutos.find(item => String(item.id) === String(id));
                if (p) {
                    document.getElementById('form-id').value = p.id;
                    document.getElementById('form-imagem-base64').value = p.imagem_url || '';
                    document.getElementById('preview-foto').src = p.imagem_url || 'https://via.placeholder.com/100';
                    document.getElementById('form-nome').value = p.nome || '';
                    document.getElementById('form-sku').value = p.sku || '';
                    document.getElementById('form-preco').value = p.preco || 0;
                    document.getElementById('form-estoque').value = p.estoque || 0;
                    document.getElementById('form-peso').value = p.peso_kg || '';
                    document.getElementById('form-comprimento').value = p.comprimento_cm || '';
                    document.getElementById('form-largura').value = p.largura_cm || '';
                    document.getElementById('form-altura').value = p.altura_cm || '';
                }
            } else {
                document.getElementById('modal-title').textContent = 'Novo Produto';
                document.getElementById('form-id').value = '';
                document.getElementById('preview-foto').src = 'https://via.placeholder.com/100';
            }
            document.getElementById('modal-produto').classList.add('active');
        }

        function fecharModalProduto() { document.getElementById('modal-produto').classList.remove('active'); }

        async function salvarProduto(e) {
            e.preventDefault();
            var id = document.getElementById('form-id').value;
            var payload = {
                imagem_url: document.getElementById('form-imagem-base64').value,
                nome: document.getElementById('form-nome').value,
                sku: document.getElementById('form-sku').value,
                preco: parseFloat(document.getElementById('form-preco').value),
                estoque: parseInt(document.getElementById('form-estoque').value),
                peso_kg: parseFloat(document.getElementById('form-peso').value) || null,
                comprimento_cm: parseFloat(document.getElementById('form-comprimento').value) || null,
                largura_cm: parseFloat(document.getElementById('form-largura').value) || null,
                altura_cm: parseFloat(document.getElementById('form-altura').value) || null
            };

            try {
                if (id) {
                    var res = await _supabase.from('outlet_produtos').update(payload).eq('id', id);
                    if(res.error) throw res.error;
                } else {
                    var res = await _supabase.from('outlet_produtos').insert([payload]);
                    if(res.error) throw res.error;
                }
                fecharModalProduto();
                await carregarBanco();
                mostrarMensagem('Produto salvo com sucesso!');
            } catch(err) {
                mostrarMensagem('Erro ao salvar no banco: ' + err.message, 'error');
            }
        }
        
        function abrirModalCusto() {
            document.getElementById('form-custo').reset();
            const dataAtual = new Date().toISOString().slice(0, 7);
            document.getElementById('custo-mes').value = dataAtual;
            atualizarLabelTipoCusto();
            document.getElementById('modal-custo').classList.add('active');
        }

        function fecharModalCusto() { document.getElementById('modal-custo').classList.remove('active'); }
        
        function atualizarLabelTipoCusto() {
            const tipo = document.getElementById('custo-tipo').value;
            const label = document.getElementById('label-nome-referencia');
            const input = document.getElementById('custo-nome-manual');
            if(tipo === 'fornecedor') {
                label.textContent = 'Nome do Fornecedor:';
                input.placeholder = 'Ex: Fornecedor João / Empresa ABC';
            } else {
                label.textContent = 'Nome da Despesa:';
                input.placeholder = 'Ex: Água, Luz, Internet, Aluguel';
            }
        }

        function renderizarEstoque(lista) {
            const tbody = document.getElementById('erp-table-body');
            if(!tbody) return;
            tbody.innerHTML = lista.map(p => `<tr>
                <td><img src="${p.imagem_url || 'https://via.placeholder.com/45'}" onerror="this.src='https://via.placeholder.com/45'"></td>
                <td style="font-size:0.8rem; color:#666;">${p.sku || '-'}</td>
                <td style="font-weight:600;">${p.nome}${temMedidas(p) ? '' : ' <i class="fa-solid fa-triangle-exclamation" style="color:#C98A00;" title="Faltam peso e medidas para calcular o frete"></i>'}</td>
                <td>${emPromocao(p) ? `<span style="text-decoration:line-through; color:#999; font-size:0.75rem;">R$ ${Number(p.preco || 0).toFixed(2).replace('.', ',')}</span><br><strong style="color:var(--success-green);">R$ ${precoVigente(p).toFixed(2).replace('.', ',')}</strong>` : `R$ ${Number(p.preco || 0).toFixed(2).replace('.', ',')}`}</td>
                <td><strong>${p.estoque || 0} un</strong></td>
                <td><button class="btn-secundary" onclick="abrirModalProduto('${p.id}')"><i class="fa-solid fa-pen"></i> Editar</button></td>
            </tr>`).join('');
        }
        function temMedidas(p) { return Number(p.peso_kg) > 0 && Number(p.comprimento_cm) > 0 && Number(p.largura_cm) > 0 && Number(p.altura_cm) > 0; }
        function atualizarAvisoMedidas() {
            const box = document.getElementById('aviso-frete-medidas');
            if(!box) return;
            const faltam = todosProdutos.filter(p => !temMedidas(p)).length;
            box.style.display = faltam ? 'block' : 'none';
            box.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>${faltam} de ${todosProdutos.length} produtos</strong> ainda sem peso e medidas (marcados com o triângulo). Eles não poderão ter frete calculado.`;
        }
        function filtrarEstoque() {
            var termo = document.getElementById('erp-search').value.toLowerCase();
            var filtrados = todosProdutos.filter(p => (p.nome || '').toLowerCase().includes(termo) || (p.sku || '').toLowerCase().includes(termo));
            renderizarEstoque(filtrados);
        }
        
        async function carregarVendas() {
            try {
                var response = await _supabase.from('outlet_vendas').select('*').order('created_at', { ascending: false });
                if (response.error) throw response.error;
                todasVendas = response.data || [];
                renderizarVendas(todasVendas);
                renderizarGraficosVendas();
            } catch (err) { console.error(err); }
        }
        
        function renderizarVendas(lista) {
            const tbody = document.getElementById('erp-vendas-body');
            
            // Combinar vendas normais e consignações concluídas/pendentes para exibição unificada
            let listaConsignasFormatadas = todasConsignacoes.map(c => ({
                id: 'CONS-' + c.id,
                cliente_nome: `Consignado: ${c.responsavel}`,
                cliente_telefone: c.telefone || '',
                itens: c.itens,
                total: c.total_estimado,
                forma_pagamento: c.status.toLowerCase() === 'concluído' ? 'Dinheiro/Acerto' : 'Consignado',
                status: c.status.toLowerCase() === 'concluído' ? 'Confirmado' : 'Pendente (Consignado)',
                created_at: c.created_at
            }));

            let listaGeralUnificada = [...lista, ...listaConsignasFormatadas];

            if(!listaGeralUnificada || listaGeralUnificada.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:20px;">Nenhuma venda ou consignação registrada.</td></tr>';
                return;
            }

            tbody.innerHTML = listaGeralUnificada.map(v => {
                let itensParsed = [];
                try { itensParsed = typeof v.itens === 'string' ? JSON.parse(v.itens) : v.itens; } catch(e) { itensParsed = []; }
                
                let itensStr = Array.isArray(itensParsed) 
                    ? itensParsed.map(it => `${it.qtd || 1}x ${it.nome || 'Produto'} (R$ ${Number(it.preco || 0).toFixed(2)})`).join('<br>') 
                    : 'Detalhes indisponíveis';

                let dataFmt = v.created_at ? new Date(v.created_at).toLocaleString('pt-BR') : '-';
                let statusAtual = (v.status || 'Pendente').trim();
                let badgeClass = 'status-pendente';
                
                if(statusAtual.toLowerCase().includes('confirmado') || statusAtual.toLowerCase().includes('concluído')) badgeClass = 'status-confirmado';
                if(statusAtual.toLowerCase().includes('cancelado')) badgeClass = 'status-cancelado';

                let botoesAcao = statusAtual.toLowerCase().includes('pendente') && !String(v.id).startsWith('CONS-')
                    ? `<button class="btn-success" onclick="abrirModalValidar('${v.id}')" style="margin-bottom:4px;">Aprovar</button><br>
                       <button class="btn-danger" onclick="alterarStatusVenda('${v.id}', 'Cancelado')">Cancelar</button>`
                    : '<span style="font-size:0.75rem; color:#666;">Concluído</span>';

                let totalVenda = Number(v.total || v.valor_total || 0).toFixed(2).replace('.', ',');

                return `
                    <tr>
                        <td style="font-size:0.75rem; color:#666;">ID: ${v.id}<br>${dataFmt}</td>
                        <td style="font-weight:600;">${v.cliente_nome || 'Cliente'}<br><span style="font-size:0.75rem; color:#666;">${v.cliente_telefone || ''}</span></td>
                        <td style="font-size:0.8rem;">${itensStr}</td>
                        <td style="font-weight:bold; color:var(--brand-burgundy);">R$ ${totalVenda}</td>
                        <td>${v.forma_pagamento || '-'}</td>
                        <td><span class="badge-status ${badgeClass}">${statusAtual}</span></td>
                        <td>${botoesAcao}</td>
                    </tr>
                `;
            }).join('');
        }

        async function abrirModalValidar(id) {
            let venda = todasVendas.find(v => String(v.id) === String(id));
            if(!venda) return;
            document.getElementById('validar-venda-id').value = venda.id;
            
            let itensParsed = [];
            try { itensParsed = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : venda.itens; } catch(e) {}
            let itensStr = Array.isArray(itensParsed) ? itensParsed.map(it => `${it.qtd}x ${it.nome}`).join(', ') : '';

            document.getElementById('validar-detalhes-pedido').innerHTML = `<strong>Cliente:</strong> ${venda.cliente_nome || 'Web'} <br><strong>Itens:</strong> ${itensStr} <br><strong>Total:</strong> R$ ${Number(venda.total || 0).toFixed(2).replace('.',',')}`;
            document.getElementById('modal-validar-venda').classList.add('active');
        }

        function fecharModalValidar() {
            document.getElementById('modal-validar-venda').classList.remove('active');
        }

        async function confirmarVendaLoja() {
            let id = document.getElementById('validar-venda-id').value;
            let formaPgto = document.getElementById('validar-forma-pagamento').value;
            let venda = todasVendas.find(v => String(v.id) === String(id));
            if(!venda) return;

            try {
                let itensParsed = [];
                try { itensParsed = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : venda.itens; } catch(e) {}

                let contagemItens = {};
                itensParsed.forEach(item => { contagemItens[item.id] = (contagemItens[item.id] || 0) + item.qtd; });

                for (let prodId in contagemItens) {
                    let prodOriginal = todosProdutos.find(p => String(p.id) === String(prodId));
                    if(prodOriginal) {
                        let novoEstoque = Math.max(0, (prodOriginal.estoque || 0) - contagemItens[prodId]);
                        await _supabase.from('outlet_produtos').update({ estoque: novoEstoque }).eq('id', prodId);
                    }
                }

                await _supabase.from('outlet_vendas').update({
                    status: 'Confirmado',
                    forma_pagamento: formaPgto
                }).eq('id', id);

                mostrarMensagem('Venda validada com sucesso e estoque atualizado!');
                fecharModalValidar();
                await carregarBanco();
                await carregarVendas();
            } catch(err) {
                mostrarMensagem('Erro ao aprovar venda: ' + err.message, 'error');
            }
        }

        async function alterarStatusVenda(id, novoStatus) {
            try {
                await _supabase.from('outlet_vendas').update({ status: novoStatus }).eq('id', id);
                mostrarMensagem(`Pedido alterado para ${novoStatus}.`);
                await carregarVendas();
            } catch(err) {
                mostrarMensagem('Erro ao atualizar status: ' + err.message, 'error');
            }
        }
        
        function filtrarTabelaVendas() {
            const termo = document.getElementById('vendas-search').value.toLowerCase();
            const statusFiltro = document.getElementById('vendas-filtro-status').value;

            let listaConsignasFormatadas = todasConsignacoes.map(c => ({
                id: 'CONS-' + c.id,
                cliente_nome: `Consignado: ${c.responsavel}`,
                cliente_telefone: c.telefone || '',
                itens: c.itens,
                total: c.total_estimado,
                forma_pagamento: c.status.toLowerCase() === 'concluído' ? 'Dinheiro/Acerto' : 'Consignado',
                status: c.status.toLowerCase() === 'concluído' ? 'Confirmado' : 'Pendente (Consignado)',
                created_at: c.created_at
            }));

            let listaGeralUnificada = [...todasVendas, ...listaConsignasFormatadas];

            let filtradas = listaGeralUnificada.filter(v => {
                let nomeCliente = (v.cliente_nome || '').toLowerCase();
                let idVenda = String(v.id || '').toLowerCase();
                let statusVenda = (v.status || 'Pendente').toLowerCase();
                let pgtoVenda = (v.forma_pagamento || '').toLowerCase();

                let matchTermo = nomeCliente.includes(termo) || idVenda.includes(termo) || pgtoVenda.includes(termo);
                let matchStatus = statusFiltro === 'todos' || statusVenda.includes(statusFiltro);

                return matchTermo && matchStatus;
            });

            renderizarVendas(filtradas);
        }

        function filtrarCardVendas(tipo) {
            if(tipo === 'pendente') {
                document.getElementById('vendas-filtro-status').value = 'pendente';
            } else {
                document.getElementById('vendas-filtro-status').value = 'todos';
            }
            document.getElementById('vendas-search.value') = '';
            filtrarTabelaVendas();
        }
        
        function renderizarGraficosVendas() {
            let pagamentosCount = {};
            let faturamentoTotal = 0;
            let totalQtd = todasVendas.length + todasConsignacoes.length;
            let totalPendentes = 0;

            todasVendas.forEach(v => {
                let pg = v.forma_pagamento || 'A definir';
                pagamentosCount[pg] = (pagamentosCount[pg] || 0) + 1;
                let val = Number(v.total || v.valor_total || 0);
                let st = (v.status || '').toLowerCase();
                if(!st.includes('cancelado')) { faturamentoTotal += val; }
                if(st.includes('pendente')) { totalPendentes++; }
            });

            todasConsignacoes.forEach(c => {
                let val = Number(c.total_estimado || 0);
                let st = (c.status || '').toLowerCase();
                if(st.includes('concluído') || st.includes('acertado')) {
                    faturamentoTotal += val;
                    pagamentosCount['Consignado Acertado'] = (pagamentosCount['Consignado Acertado'] || 0) + 1;
                } else {
                    totalPendentes++;
                    pagamentosCount['Consignado Pendente'] = (pagamentosCount['Consignado Pendente'] || 0) + 1;
                }
            });

            let ticketMedio = totalQtd > 0 ? faturamentoTotal / totalQtd : 0;

            document.getElementById('vendas-total-fat').textContent = `R$ ${faturamentoTotal.toFixed(2).replace('.', ',')}`;
            document.getElementById('vendas-total-qtd').textContent = totalQtd;
            document.getElementById('vendas-ticket-medio').textContent = `R$ ${ticketMedio.toFixed(2).replace('.', ',')}`;
            document.getElementById('vendas-total-pendentes').textContent = totalPendentes;

            const ctxPag = document.getElementById('chartVendasPagamento').getContext('2d');
            if(chartPagamentoInstance) chartPagamentoInstance.destroy();

            chartPagamentoInstance = new Chart(ctxPag, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(pagamentosCount),
                    datasets: [{
                        data: Object.values(pagamentosCount),
                        backgroundColor: ['#7C1826', '#C09A53', '#198754', '#0d6efd', '#ffc107', '#6c757d', '#20c997']
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } },
                    onClick: (e, activeEls) => {
                        if(activeEls.length > 0) {
                            let labelPag = Object.keys(pagamentosCount)[activeEls[0].index];
                            document.getElementById('vendas-search').value = labelPag;
                            filtrarTabelaVendas();
                        }
                    }
                }
            });

            let statusCount = { 'Confirmado': 0, 'Pendente': 0, 'Cancelado': 0 };
            todasVendas.forEach(v => {
                let st = (v.status || 'Pendente').toLowerCase();
                if(st.includes('confirmado')) statusCount['Confirmado']++;
                else if(st.includes('pendente')) statusCount['Pendente']++;
                else if(st.includes('cancelado')) statusCount['Cancelado']++;
                else statusCount['Pendente']++;
            });

            todasConsignacoes.forEach(c => {
                let st = (c.status || 'Pendente').toLowerCase();
                if(st.includes('concluído') || st.includes('acertado')) statusCount['Confirmado']++;
                else statusCount['Pendente']++;
            });

            const ctxStatus = document.getElementById('chartVendasStatus').getContext('2d');
            if(chartStatusInstance) chartStatusInstance.destroy();

            chartStatusInstance = new Chart(ctxStatus, {
                type: 'bar',
                data: {
                    labels: Object.keys(statusCount),
                    datasets: [{
                        label: 'Qtd de Pedidos',
                        data: Object.values(statusCount),
                        backgroundColor: ['#198754', '#ffc107', '#dc3545']
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }, 
                    plugins: { legend: { display: false } },
                    onClick: (e, activeEls) => {
                        if(activeEls.length > 0) {
                            let labelStatus = Object.keys(statusCount)[activeEls[0].index].toLowerCase();
                            document.getElementById('vendas-filtro-status').value = labelStatus;
                            filtrarTabelaVendas();
                        }
                    }
                }
            });
        }
        
        async function carregarCustosDespesas() {
            try {
                const { data, error } = await _supabase.from('outlet_custos_despesas').select('*').order('created_at', { ascending: false });
                if(error) throw error;
                todosCustos = data || [];
                renderizarGraficoCustosAno();
                atualizarCardsResumoCustos();
                aplicarFiltrosTabelaCustos();
                atualizarAlertaVencimentos();
            } catch(err) { console.error(err); }
        }
        
        function renderizarGraficoCustosAno() {
            let anosMap = {};
            todosCustos.forEach(item => {
                let ano = item.mes_ano ? item.mes_ano.split('-')[0] : '2026';
                anosMap[ano] = (anosMap[ano] || 0) + Number(item.valor || 0);
            });

            let anosOrdenados = Object.keys(anosMap).sort();
            if(anosOrdenados.length === 0) {
                anosOrdenados = [String(new Date().getFullYear())];
                anosMap[anosOrdenados[0]] = 0;
            }

            const ctxAno = document.getElementById('chartCustosAno').getContext('2d');
            if(chartCustosAnoInstance) chartCustosAnoInstance.destroy();

            chartCustosAnoInstance = new Chart(ctxAno, {
                type: 'bar',
                data: {
                    labels: anosOrdenados,
                    datasets: [{
                        label: 'Total de Custos (R$)',
                        data: anosOrdenados.map(a => anosMap[a]),
                        backgroundColor: '#7C1826',
                        borderRadius: 8
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { y: { beginAtZero: true, ticks: { callback: function(value) { return 'R$ ' + value.toLocaleString('pt-BR'); } } } }, 
                    plugins: { legend: { display: false } } 
                }
            });
        }
        
        function atualizarCardsResumoCustos() {
            const mesFiltro = document.getElementById('filtro-mes-custos').value;
            let custosFiltradosMes = mesFiltro ? todosCustos.filter(item => item.mes_ano === mesFiltro) : todosCustos;

            let totalGeral = 0, totalFornecedor = 0, totalOperacional = 0;
            custosFiltradosMes.forEach(item => {
                let val = Number(item.valor || 0);
                totalGeral += val;
                if(item.tipo === 'fornecedor') totalFornecedor += val;
                else if(item.tipo === 'operacional') totalOperacional += val;
            });

            document.getElementById('card-total-geral').textContent = `R$ ${totalGeral.toFixed(2).replace('.',',')}`;
            document.getElementById('card-total-fornecedor').textContent = `R$ ${totalFornecedor.toFixed(2).replace('.',',')}`;
            document.getElementById('card-total-operacional').textContent = `R$ ${totalOperacional.toFixed(2).replace('.',',')}`;
        }
        
        function aplicarFiltrosTabelaCustos() {
            const mesFiltro = document.getElementById('filtro-mes-custos').value;
            let filtrados = mesFiltro ? todosCustos.filter(item => item.mes_ano === mesFiltro) : todosCustos;

            if(filtroTipoCustoAtual !== 'todos') {
                filtrados = filtrados.filter(item => item.tipo === filtroTipoCustoAtual);
            }

            const tbody = document.getElementById('erp-custos-body');
            if(!filtrados || filtrados.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:20px;">Nenhum custo registrado para este filtro.</td></tr>';
                document.getElementById('total-custos-mes').textContent = 'R$ 0,00';
                return;
            }

            let html = '';
            let somaFiltro = 0;
            filtrados.forEach(item => {
                somaFiltro += Number(item.valor || 0);
                const badgeTipo = item.tipo === 'fornecedor' ? '<span class="badge-status status-confirmado">Fornecedor</span>' : '<span class="badge-status status-pendente">Operacional</span>';
                html += `
                    <tr>
                        <td>${badgeTipo}</td>
                        <td style="font-weight:600;">${item.nome_referencia}</td>
                        <td>${item.mes_ano}</td>
                        <td>${celulaVencimento(item)}</td>
                        <td style="color:var(--danger-red); font-weight:bold;">R$ ${Number(item.valor).toFixed(2).replace('.',',')}</td>
                        <td style="font-size:0.85rem; color:#666;">${item.observacao || '-'}</td>
                        <td style="white-space:nowrap;">${(item.data_vencimento && !item.pago) ? `<button class="btn-success" onclick="marcarCustoPago(${item.id})"><i class="fa-solid fa-check"></i> Pago</button> ` : ''}<button class="btn-danger" onclick="excluirCusto(${item.id})"><i class="fa-solid fa-trash"></i> Excluir</button></td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
            document.getElementById('total-custos-mes').textContent = `R$ ${somaFiltro.toFixed(2).replace('.',',')}`;
            atualizarCardsResumoCustos();
        }

        async function excluirCusto(id) {
            if(!confirm('Deseja realmente excluir este custo?')) return;
            try {
                await _supabase.from('outlet_custos_despesas').delete().eq('id', id);
                mostrarMensagem('Custo excluído com sucesso!');
                carregarCustosDespesas();
            } catch(err) { mostrarMensagem('Erro ao excluir: ' + err.message, 'error'); }
        }

        async function salvarCustoDespesa(e) {
            e.preventDefault();
            const payload = {
                tipo: document.getElementById('custo-tipo').value,
                nome_referencia: document.getElementById('custo-nome-manual').value,
                mes_ano: document.getElementById('custo-mes').value,
                valor: parseFloat(document.getElementById('custo-valor').value),
                observacao: document.getElementById('custo-obs').value,
                data_vencimento: document.getElementById('custo-vencimento').value || null,
                pago: false
            };

            try {
                const { error } = await _supabase.from('outlet_custos_despesas').insert([payload]);
                if(error) throw error;
                mostrarMensagem('Custo registrado com sucesso!');
                fecharModalCusto();
                carregarCustosDespesas();
            } catch(err) {
                mostrarMensagem('Erro ao salvar custo. Certifique-se de executar no SQL Editor: ALTER TABLE outlet_custos_despesas DISABLE ROW LEVEL SECURITY;', 'error');
            }
        }
        

        /* ======= VENCIMENTOS DE FORNECEDORES / LEMBRETES ======= */
        function diasAte(dataISO) {
            const p = dataISO.split('-').map(Number);
            const alvo = new Date(p[0], p[1]-1, p[2]);
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            return Math.round((alvo - hoje) / 86400000);
        }
        function celulaVencimento(item) {
            if(!item.data_vencimento) return '-';
            if(item.pago) return '<span class="badge-status status-confirmado">Pago</span>';
            const d = diasAte(item.data_vencimento);
            const cor = d < 0 ? 'var(--danger-red)' : (d <= DIAS_ALERTA_VENCIMENTO ? '#856404' : '#333');
            const txt = d < 0 ? `vencido há ${-d} dia(s)` : (d === 0 ? 'vence hoje' : `em ${d} dia(s)`);
            return `<strong style="color:${cor};">${formatarDataBR(item.data_vencimento)}</strong><br><span style="font-size:0.72rem; color:${cor};">${txt}</span>`;
        }
        function atualizarAlertaVencimentos() {
            const box = document.getElementById('alerta-vencimentos');
            if(!box) return;
            const pend = todosCustos.filter(c => c.data_vencimento && !c.pago)
                .map(c => Object.assign({}, c, { dias: diasAte(c.data_vencimento) }))
                .filter(c => c.dias <= DIAS_ALERTA_VENCIMENTO)
                .sort((a, b) => a.dias - b.dias);
            if(pend.length === 0) { box.style.display = 'none'; box.innerHTML = ''; return; }
            box.style.display = 'block';
            box.innerHTML = '<strong><i class="fa-solid fa-bell"></i> Pagamentos próximos do vencimento</strong>' + pend.map(c => {
                const txt = c.dias < 0 ? `venceu há ${-c.dias} dia(s)` : (c.dias === 0 ? 'vence hoje' : `vence em ${c.dias} dia(s)`);
                return `<div style="margin-top:8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;"><span>${c.nome_referencia} — R$ ${Number(c.valor).toFixed(2).replace('.', ',')} — <strong style="color:${c.dias <= 0 ? 'var(--danger-red)' : '#856404'};">${txt}</strong> (${formatarDataBR(c.data_vencimento)})</span><button class="btn-success" onclick="marcarCustoPago(${c.id})">Marcar como pago</button></div>`;
            }).join('');
            if(!alertaVencimentoJaAvisado) {
                alertaVencimentoJaAvisado = true;
                mostrarMensagem(`${pend.length} pagamento(s) de fornecedor/despesa próximo(s) do vencimento.`, 'warning');
            }
        }
        async function marcarCustoPago(id) {
            const { error } = await _supabase.from('outlet_custos_despesas').update({ pago: true }).eq('id', id);
            if(error) { mostrarMensagem('Erro ao marcar como pago: ' + error.message, 'error'); return; }
            mostrarMensagem('Pagamento marcado como pago.');
            carregarCustosDespesas();
        }

        /* ======= PROMOÇÕES ======= */
        function renderizarPromocoes() {
            const tbody = document.getElementById('promo-body');
            if(!tbody) return;
            const termo = (document.getElementById('promo-search').value || '').toLowerCase();
            const lista = todosProdutos.filter(p => (p.nome || '').toLowerCase().includes(termo) || (p.sku || '').toLowerCase().includes(termo));
            const estiloInput = 'padding:6px; border:1px solid #CCC; border-radius:6px; font-size:0.85rem;';
            tbody.innerHTML = lista.map(p => {
                const ativa = emPromocao(p);
                const encerrada = p.preco_promocional && !ativa;
                const situacao = ativa ? '<span class="badge-status status-confirmado">Em promoção</span>' : (encerrada ? '<span class="badge-status status-cancelado">Encerrada</span>' : '-');
                return `<tr>
                    <td style="font-weight:600;">${p.nome}</td>
                    <td>R$ ${Number(p.preco || 0).toFixed(2).replace('.', ',')}</td>
                    <td><input type="number" step="0.01" min="0.01" id="promo-preco-${p.id}" value="${p.preco_promocional || ''}" style="width:110px; ${estiloInput}"></td>
                    <td><input type="date" id="promo-fim-${p.id}" value="${p.promocao_fim || ''}" style="${estiloInput}"></td>
                    <td>${situacao}</td>
                    <td style="white-space:nowrap;"><button class="btn-success" onclick="aplicarPromocao('${p.id}')">Aplicar</button> ${p.preco_promocional ? `<button class="btn-danger" onclick="encerrarPromocao('${p.id}')">Encerrar</button>` : ''}</td>
                </tr>`;
            }).join('');
        }
        async function aplicarPromocao(id) {
            const p = todosProdutos.find(x => String(x.id) === String(id));
            if(!p) return;
            const preco = parseFloat(document.getElementById('promo-preco-' + id).value);
            const fim = document.getElementById('promo-fim-' + id).value;
            if(!(preco > 0) || !fim) { mostrarMensagem('Informe o preço promocional e a data final.', 'warning'); return; }
            if(preco >= Number(p.preco)) { mostrarMensagem('O preço promocional precisa ser menor que o preço original.', 'warning'); return; }
            if(fim < hojeISO()) { mostrarMensagem('A data final não pode estar no passado.', 'warning'); return; }
            const { error } = await _supabase.from('outlet_produtos').update({ preco_promocional: preco, promocao_fim: fim }).eq('id', id);
            if(error) { mostrarMensagem('Erro ao salvar promoção: ' + error.message + ' (rode o arquivo atualizacao_banco.sql no Supabase)', 'error'); return; }
            mostrarMensagem('Promoção aplicada!');
            await carregarBanco();
        }
        async function encerrarPromocao(id) {
            if(!confirm('Encerrar esta promoção agora e voltar ao preço original?')) return;
            const { error } = await _supabase.from('outlet_produtos').update({ preco_promocional: null, promocao_fim: null }).eq('id', id);
            if(error) { mostrarMensagem('Erro: ' + error.message, 'error'); return; }
            mostrarMensagem('Promoção encerrada.');
            await carregarBanco();
        }


        /* ======= PLANILHA DE PRODUTOS (nome, peso e medidas) ======= */
        function csvCelula(v) { v = (v === null || v === undefined) ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        function numParaCsv(v) { return (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ','); }
        function baixarPlanilhaProdutos() {
            if(todosProdutos.length === 0) { mostrarMensagem('Nenhum produto carregado.', 'warning'); return; }
            const cab = ['id', 'sku', 'nome', 'preco (so consulta)', 'estoque (so consulta)', 'peso_kg', 'comprimento_cm', 'largura_cm', 'altura_cm'];
            const linhas = todosProdutos.map(p => [p.id, p.sku, p.nome, numParaCsv(p.preco), p.estoque, numParaCsv(p.peso_kg), numParaCsv(p.comprimento_cm), numParaCsv(p.largura_cm), numParaCsv(p.altura_cm)].map(csvCelula).join(';'));
            const csv = '\uFEFF' + [cab.join(';')].concat(linhas).join('\r\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            a.download = 'produtos-outlet-catolico.csv';
            a.click();
            URL.revokeObjectURL(a.href);
            mostrarMensagem('Planilha baixada. Preencha nome, peso e medidas e envie de volta.');
        }
        function lerCsv(texto) {
            texto = texto.replace(/^\uFEFF/, '');
            const primeira = texto.split(/\r?\n/)[0] || '';
            const sep = primeira.indexOf(';') >= 0 ? ';' : ',';
            const linhas = []; let linha = [], cel = '', aspas = false;
            for(let i = 0; i < texto.length; i++) {
                const c = texto[i];
                if(aspas) {
                    if(c === '"' && texto[i+1] === '"') { cel += '"'; i++; }
                    else if(c === '"') aspas = false;
                    else cel += c;
                } else if(c === '"') aspas = true;
                else if(c === sep) { linha.push(cel); cel = ''; }
                else if(c === '\n' || c === '\r') {
                    if(c === '\r' && texto[i+1] === '\n') i++;
                    linha.push(cel); cel = '';
                    if(linha.some(x => x.trim() !== '')) linhas.push(linha);
                    linha = [];
                } else cel += c;
            }
            linha.push(cel);
            if(linha.some(x => x.trim() !== '')) linhas.push(linha);
            return linhas;
        }
        function csvParaNumero(v) {
            v = String(v || '').trim().replace(/\s/g, '');
            if(v === '') return null;
            if(v.indexOf(',') >= 0) v = v.replace(/\./g, '').replace(',', '.');
            const n = parseFloat(v);
            return isNaN(n) || n <= 0 ? null : n;
        }
        function importarPlanilhaProdutos(input) {
            const arq = input.files[0];
            if(!arq) return;
            const leitor = new FileReader();
            leitor.onload = async function(e) {
                input.value = '';
                const linhas = lerCsv(e.target.result);
                if(linhas.length < 2) { mostrarMensagem('Planilha vazia ou em formato inesperado.', 'error'); return; }
                const cab = linhas[0].map(c => c.trim().toLowerCase());
                const col = nome => cab.findIndex(c => c.startsWith(nome));
                const iId = col('id'), iNome = col('nome'), iPeso = col('peso_kg'), iComp = col('comprimento_cm'), iLarg = col('largura_cm'), iAlt = col('altura_cm');
                if(iId < 0 || iPeso < 0 || iComp < 0 || iLarg < 0 || iAlt < 0) { mostrarMensagem('Use a planilha baixada pelo botão "Baixar planilha" (colunas id, peso_kg, comprimento_cm, largura_cm, altura_cm).', 'error'); return; }
                const mudancas = [];
                linhas.slice(1).forEach(l => {
                    const prod = todosProdutos.find(p => String(p.id) === String(l[iId]).trim());
                    if(!prod) return;
                    const novo = {};
                    const nome = iNome >= 0 ? (l[iNome] || '').trim() : '';
                    if(nome && nome !== (prod.nome || '')) novo.nome = nome;
                    [['peso_kg', iPeso], ['comprimento_cm', iComp], ['largura_cm', iLarg], ['altura_cm', iAlt]].forEach(par => {
                        const n = csvParaNumero(l[par[1]]);
                        if(n !== null && n !== Number(prod[par[0]])) novo[par[0]] = n;
                    });
                    if(Object.keys(novo).length) mudancas.push({ id: prod.id, dados: novo });
                });
                if(mudancas.length === 0) { mostrarMensagem('Nenhuma alteração encontrada na planilha.', 'warning'); return; }
                if(!confirm(`${mudancas.length} produto(s) serão atualizados (nome, peso e medidas). Preço e estoque não são alterados. Continuar?`)) return;
                let erros = 0;
                for(const m of mudancas) {
                    const { error } = await _supabase.from('outlet_produtos').update(m.dados).eq('id', m.id);
                    if(error) erros++;
                }
                await carregarBanco();
                if(erros) mostrarMensagem(`${mudancas.length - erros} atualizados, ${erros} com erro (confira se rodou o atualizacao_banco.sql).`, 'error');
                else mostrarMensagem(`${mudancas.length} produto(s) atualizados com sucesso!`);
            };
            leitor.readAsText(arq, 'UTF-8');
        }

        function acionarCamera() { document.getElementById('input-camera').click(); }
        function converterArquivoParaBase64(inputElement) {
            var file = inputElement.files[0];
            if (file) {
                var reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById('form-imagem-base64').value = e.target.result;
                    document.getElementById('preview-foto').src = e.target.result;
                };
                reader.readAsDataURL(file);
            }
        }
        
        function filtrarTipoCusto(tipo, cardElement) {
            filtroTipoCustoAtual = tipo;
            document.querySelectorAll('#aba-fornecedores .summary-card').forEach(c => c.classList.remove('active-filter'));
            if(cardElement) cardElement.classList.add('active-filter');
            aplicarFiltrosTabelaCustos();
        }

console.log('painel.js v2 carregado');
