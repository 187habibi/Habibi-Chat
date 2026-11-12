local open = false
local chatHidden = false
local closedAt = 0

local function isOtherUiOpen()
    return IsPauseMenuActive()
        or IsScreenFadedOut()
        or (LocalPlayer and LocalPlayer.state and LocalPlayer.state.invOpen == true)
        or (not open and IsNuiFocused() and (GetGameTimer() - closedAt) > 400)
end

local function addMessage(message)
    SendNUIMessage({ action = 'message', message = message })
end

exports('addMessage', addMessage)
RegisterNetEvent('chat:addMessage', addMessage)

RegisterNetEvent('chatMessage', function(author, color, message)
    addMessage({ color = color, args = { author, message } })
end)

local function addSuggestion(name, help, params)
    SendNUIMessage({ action = 'suggest', name = name, help = help, params = params })
end

exports('addSuggestion', addSuggestion)
RegisterNetEvent('chat:addSuggestion', addSuggestion)

RegisterNetEvent('chat:addSuggestions', function(suggestions)
    for _, suggestion in ipairs(suggestions) do
        addSuggestion(suggestion.name, suggestion.help, suggestion.params)
    end
end)

RegisterNetEvent('chat:removeSuggestion', function(name)
    SendNUIMessage({ action = 'remove', name = name })
end)

RegisterNetEvent('chat:addTemplate', function(id, html)
    SendNUIMessage({ action = 'template', id = id, html = html })
end)

RegisterNetEvent('chat:clear', function()
    SendNUIMessage({ action = 'clear' })
end)

RegisterCommand('clear', function()
    SendNUIMessage({ action = 'clear' })
end, false)

RegisterNetEvent('rpchat:suggestions', function(suggestions)
    for _, command in ipairs(GetRegisteredCommands()) do
        local name = command.name
        if name ~= 'rpchat_open' and name ~= 'clear' and name ~= 'ic' and IsAceAllowed('command.' .. name) then
            suggestions[#suggestions + 1] = { name = '/' .. name }
        end
    end
    suggestions[#suggestions + 1] = { name = '/clear', help = 'Wyczyść lokalną historię czatu' }
    SendNUIMessage({ action = 'builtins', suggestions = suggestions })
end)

RegisterCommand('rpchat_open', function()
    if open or isOtherUiOpen() then return end
    open = true
    SetNuiFocus(true, false)
    SendNUIMessage({ action = 'open' })
    TriggerServerEvent('rpchat:requestSuggestions')
end, false)

RegisterKeyMapping('rpchat_open', 'Otworz czat RP', 'keyboard', 't')

RegisterNUICallback('submit', function(data, reply)
    reply({})
    if not open then return end
    open = false
    closedAt = GetGameTimer()
    SetNuiFocus(false, false)
    local message = type(data.text) == 'string' and data.text
    if not message or #message == 0 or #message > 1024 then return end
    local mode = type(data.mode) == 'string' and data.mode or 'ic'
    if mode == 'command' and message:sub(1, 1) == '/' then
        local command = message:sub(2)
        if command:match('^ic%s*$') or command:match('^ic%s') then return end
        -- Route RP commands directly to this chat, avoiding another resource's /me or /do.
        local rp, text = command:match('^(%S+)%s+(.+)$')
        rp = rp and rp:lower()
        if rp == 'me' or rp == 'do' or rp == 'try' then
            TriggerServerEvent('rpchat:submit', rp, text)
        else
            ExecuteCommand(command)
        end
    elseif mode == 'ic' or mode == 'me' or mode == 'do' or mode == 'try' or mode == 'ooc' or mode == 'report' then
        TriggerServerEvent('rpchat:submit', mode, message)
    end
end)

CreateThread(function()
    while true do
        local shouldHide = isOtherUiOpen()
        if shouldHide ~= chatHidden then
            chatHidden = shouldHide
            if shouldHide and open then
                open = false
                SetNuiFocus(false, false)
            end
            SendNUIMessage({ action = 'visibility', hidden = shouldHide })
        end
        Wait(150)
    end
end)

AddEventHandler('onClientResourceStop', function(resource)
    if resource == GetCurrentResourceName() and open then SetNuiFocus(false, false) end
end)

local overhead = {}
local overheadSequence = 0
local OVERHEAD_FADE_MS = 350 -- ostatnie ms zycia dymku: gasnie, nadal podazajac za postacia
RegisterNetEvent('rpchat:overhead', function(serverId, mode, text, success)
    if type(serverId) ~= 'number' or (mode ~= 'me' and mode ~= 'do' and mode ~= 'try') or type(text) ~= 'string' then return end
    overheadSequence = overheadSequence + 1
    local now = GetGameTimer()
    overhead[#overhead + 1] = {
        id = overheadSequence, serverId = serverId, mode = mode, text = text, success = success == true,
        born = now, expires = now + math.min(12000, math.max(6000, #text * 50)),
    }
    local count = 0
    for i = #overhead, 1, -1 do
        if overhead[i].serverId == serverId then
            count = count + 1
            if count > 3 then table.remove(overhead, i) end
        end
    end
    if #overhead > 64 then table.remove(overhead, 1) end
end)

-- Wynik sprawdzania widocznosci (LOS) trzymany przez 250 ms: natywka potrafi
-- "mrugac" klatka po klatce, przez co dymki znikaly i pojawialy sie od nowa.
local losCache = {}
local function hasLineOfSight(ownPed, ped, serverId, now)
    if ped == ownPed then return true end
    local cached = losCache[serverId]
    if not cached or cached.ped ~= ped or now - cached.at > 250 then
        cached = { ped = ped, at = now, ok = HasEntityClearLosToEntity(ownPed, ped, 17) and true or false }
        losCache[serverId] = cached
    end
    return cached.ok
end

CreateThread(function()
    local hadFrames = false
    while true do
        if #overhead == 0 then
            if hadFrames then SendNUIMessage({ action = 'overhead', entries = {} }); hadFrames = false end
            losCache = {}
            Wait(100)
        else
            local now = GetGameTimer()
            local frames, stacks = {}, {}
            local ownPed = PlayerPedId()
            local origin = GetEntityCoords(ownPed)
            for i = #overhead, 1, -1 do
                local entry = overhead[i]
                if now >= entry.expires then
                    table.remove(overhead, i)
                elseif not IsPauseMenuActive() and not IsScreenFadedOut() then
                    local index = GetPlayerFromServerId(entry.serverId)
                    if index ~= -1 then
                        local ped = GetPlayerPed(index)
                        if DoesEntityExist(ped) then
                            local distance = #(origin - GetEntityCoords(ped))
                            -- dymek jest sledzony do 30 m; poza 20 m albo za sciana tylko
                            -- plynnie gasnie, ale dalej trzyma sie postaci (wczesniej
                            -- znikal w miejscu, gdy postac biegla)
                            if distance <= 30.0 then
                                local head = GetPedBoneCoords(ped, 31086, 0.0, 0.0, 0.0)
                                local shown, x, y = World3dToScreen2d(head.x, head.y, head.z + 0.35)
                                if shown then
                                    local visible = IsEntityVisible(ped) and distance <= 20.0
                                        and hasLineOfSight(ownPed, ped, entry.serverId, now)
                                    local stack = stacks[entry.serverId] or 0
                                    stacks[entry.serverId] = stack + 1
                                    frames[#frames + 1] = {
                                        id = entry.id, mode = entry.mode, text = entry.text, success = entry.success,
                                        x = x, y = y, stack = stack, age = now - entry.born,
                                        visible = visible, leaving = now >= entry.expires - OVERHEAD_FADE_MS,
                                    }
                                end
                            end
                        end
                    end
                end
            end
            -- nie zasypuj NUI pustymi ramkami co klatke, gdy nic nie widac
            if #frames > 0 or hadFrames then
                SendNUIMessage({ action = 'overhead', entries = frames })
            end
            hadFrames = #frames > 0
            Wait(0)
        end
    end
end)
