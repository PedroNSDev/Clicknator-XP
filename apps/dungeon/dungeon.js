
const state = {
  personagens: [],
  inimigos: [],
  party: [],
  inventory: [],
  enemy: null,
  room: 0,
  loop: null
}

// =========================
// main
// =========================
import { state } from './state.js'

async function load(){
  state.personagens = await fetch('personagens.json').then(r=>r.json())
  state.inimigos = await fetch('inimigos.json').then(r=>r.json())
  showMenu()
}

// ================= UI =================
function showMenu(){
  const el = document.getElementById('app')
  el.innerHTML = '<h2>Escolha seu time (até 5)</h2>'

  state.party = []

  state.personagens.forEach(p=>{
    const b = document.createElement('button')
    b.innerText = p.name
    b.onclick = ()=>{
      if(state.party.length < 5){
        const clone = JSON.parse(JSON.stringify(p))
        clone.baseAtk = clone.atk
        state.party.push(clone)
      }
    }
    el.appendChild(b)
  })

  const start = document.createElement('button')
  start.innerText = 'Iniciar'
  start.onclick = startGame
  el.appendChild(start)
}

function showInventory(){
  const el = document.getElementById('app')
  el.innerHTML = '<h2>Inventário</h2>'

  state.inventory.forEach(it=>{
    el.innerHTML += `<div>${it.name} (+${it.atk||0})</div>`
  })
}

function renderBattle(){
  const el = document.getElementById('app')

  el.innerHTML = `
  <div id='battle'>
    <div class='enemy'>
      <img id='enemy-img' src='${state.enemy.idle}'>
      <div class='bar'><div id='enemy-hp' class='fill'></div></div>
    </div>
    <div class='party'></div>
  </div>`

  const pdiv = el.querySelector('.party')

  state.party.forEach((c,i)=>{
    c.maxHp = c.hp
    c.atkProg = 0

    const d = document.createElement('div')
    d.className = 'card'

    d.innerHTML = `
      <img id='pimg-${i}' src='${c.idle}'>
      <div class='bar'><div id='php-${i}' class='fill'></div></div>
      <div class='bar'><div id='patk-${i}' class='fill atk'></div></div>
    `

    pdiv.appendChild(d)
  })
}

function updateUI(){
  state.party.forEach((c,i)=>{
    const hp = document.getElementById(`php-${i}`)
    const atk = document.getElementById(`patk-${i}`)

    if(hp) hp.style.width = (c.hp/c.maxHp*100)+'%'
    if(atk) atk.style.width = c.atkProg+'%'
  })

  const e = document.getElementById('enemy-hp')
  if(e) e.style.width = (state.enemy.hp/state.enemy.maxHp*100)+'%'
}

// ================= GAME =================
function startGame(){
  state.room = 0
  nextRoom()
}

function nextRoom(){
  state.room++
  spawnEnemy()
  renderBattle()
  startLoop()
}

function spawnEnemy(){
  const base = state.inimigos[Math.floor(Math.random()*state.inimigos.length)]
  state.enemy = JSON.parse(JSON.stringify(base))

  state.enemy.maxHp = state.enemy.hp + state.room * 10
  state.enemy.hp = state.enemy.maxHp
  state.enemy.atk += state.room
  state.enemy.atkProg = 0
}

function startLoop(){
  if(state.loop) clearInterval(state.loop)

  state.loop = setInterval(()=>{

    // derrota
    if(state.party.length === 0){
      clearInterval(state.loop)
      showMenu()
      return
    }

    // vitória
    if(state.enemy.hp <= 0){
      dropLoot()
      nextRoom()
      return
    }

    updateCombat()
    updateUI()

  },50)
}

function updateCombat(){

  //personagens
  state.party.forEach((c,i)=>{
    c.atkProg += c.speed/50

    if(c.atkProg >= 100){
      c.atkProg = 0

      const img = document.getElementById(`pimg-${i}`)
      if(img){
        img.src = c.atkImg
        setTimeout(()=> img.src = c.idle, 120)
      }

      state.enemy.hp -= c.atk
    }
  })
//enemy 
  state.enemy.atkProg += state.enemy.speed/50

  if(state.enemy.atkProg >= 100){
    state.enemy.atkProg = 0

    const target = state.party[Math.floor(Math.random()*state.party.length)]

    if(target){
      target.hp -= state.enemy.atk

      if(target.hp <= 0){
        const index = state.party.indexOf(target)
        if(index > -1) state.party.splice(index,1)
      }
    }
  }
}

// ================= LOOT =================
function dropLoot(){
  if(Math.random() < 0.5){
    const item = { name:'Espada', atk:5 }

    state.inventory.push(item)
    state.party.forEach(p=>{
      p.atk = p.baseAtk + item.atk
    })
  }
}

// ================= VISUAL FEEDBACK (DOPAMINA FAHHHH)=================
function flashEnemy(){
  const el = document.getElementById('enemy-img')
  if(!el) return
  el.style.filter = 'brightness(2)'
  el.style.transform = 'translateX(-50%) scale(1.05)'
  setTimeout(()=>{
    el.style.filter = 'none'
    el.style.transform = 'translateX(-50%) scale(1)'
  },80)
}

function flashPlayer(i){
  const el = document.getElementById(`pimg-${i}`)
  if(!el) return
  el.style.filter = 'brightness(2)'
  setTimeout(()=> el.style.filter = 'none', 80)
}

function createDamageNumber(x, y, value){
  const dmg = document.createElement('div')
  dmg.innerText = value
  dmg.style.position = 'absolute'
  dmg.style.left = x + 'px'
  dmg.style.top = y + 'px'
  dmg.style.color = '#ff4444'
  dmg.style.fontSize = '14px'
  dmg.style.pointerEvents = 'none'
  dmg.style.transition = 'all 0.5s ease-out'

  document.body.appendChild(dmg)

  setTimeout(()=>{
    dmg.style.top = (y - 30) + 'px'
    dmg.style.opacity = 0
  },10)

  setTimeout(()=> dmg.remove(), 500)
}

// =================  COMBAT =================
const _oldUpdateCombat = updateCombat
updateCombat = function(){

  // players
  state.party.forEach((c,i)=>{
    c.atkProg += c.speed/50

    if(c.atkProg >= 100){
      c.atkProg = 0

      const img = document.getElementById(`pimg-${i}`)
      if(img){
        img.src = c.atkImg
        setTimeout(()=> img.src = c.idle, 120)
      }

      flashEnemy()
      createDamageNumber(window.innerWidth/2, window.innerHeight*0.25, c.atk)

      state.enemy.hp -= c.atk
    }
  })

  // inimigo
  state.enemy.atkProg += state.enemy.speed/50

  if(state.enemy.atkProg >= 100){
    state.enemy.atkProg = 0

    const index = Math.floor(Math.random()*state.party.length)
    const target = state.party[index]

    if(target){
      flashPlayer(index)
      createDamageNumber(200 + index*100, window.innerHeight*0.8, state.enemy.atk)

      target.hp -= state.enemy.atk

      if(target.hp <= 0){
        const i = state.party.indexOf(target)
        if(i > -1) state.party.splice(i,1)
      }
    }
  }
}
window.showMenu = showMenu
window.showInventory = showInventory
// ================= INIT =================
load()
