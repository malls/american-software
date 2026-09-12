#!/bin/bash
# AS-109 review battery — agent:qa-ruben. Runs the plan's 13 mutants + 2 controls, then M6 probes.
D=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-109
R="bash $D/mutate.sh"
SQ="'"
which=${1:-all}

run() { # name edit pat line [src]
  $R "$@" 2>&1
  echo
}

if [ "$which" = all ] || [ "$which" = plan ]; then
# --- controls (master's api.test.js) ---
run M1-control-master "lines[4]=lines[4].replace('<path fill=\"#1C41E3\" ','<path fill=\"#1C41E3\" stroke=\"#1C41E3\" '); lines[5]=lines[5].replace('fill=\"#FFFFFF\"',\"fill='red'\")" "fill='red'" 6 master
run M4-control-master "lines[4]=lines[4].replace('v-4z\"/>','v-4z\"><set attributeName=\"fill\" to=\"red\"/></path>')" '<set attributeName="fill" to="red"/>' 5 master
# --- AC-1 ---
run M1 "lines[4]=lines[4].replace('<path fill=\"#1C41E3\" ','<path fill=\"#1C41E3\" stroke=\"#1C41E3\" '); lines[5]=lines[5].replace('fill=\"#FFFFFF\"',\"fill='red'\")" "fill='red'" 6
run M2 "lines[5]=lines[5].replace('fill=\"#FFFFFF\"',\"fill='red'\")" "fill='red'" 6
# --- AC-3 (expected GREEN) ---
run M3 "lines[5]=lines[5].replace('fill=\"#FFFFFF\"',\"fill='#FFFFFF'\")" "fill='#FFFFFF'" 6
# --- AC-2 ---
run M4 "lines[4]=lines[4].replace('v-4z\"/>','v-4z\"><set attributeName=\"fill\" to=\"red\"/></path>')" '<set attributeName="fill" to="red"/>' 5
run M5 "lines[5]=lines[5].replace('r=\"2.5\"/>','r=\"2.5\"><animate attributeName=\"fill\" values=\"#1C41E3;red\" dur=\"1s\"/></circle>')" '<animate attributeName="fill"' 6
run M6 "lines[5]=lines[5].replace('r=\"2.5\"/>','r=\"2.5\"><animateTransform attributeName=\"transform\" type=\"rotate\" from=\"0\" to=\"360\" dur=\"1s\"/></circle>')" '<animateTransform ' 6
# --- AC-4: AS-28's six ---
run M3a "lines[4]=lines[4].replace('fill=\"#1C41E3\"','fill=\"#FF0000\"')" 'fill="#FF0000"' 5
run M3b "lines=lines.map(l=>l.replace(/#1C41E3/g,'none').replace(/#FFFFFF/g,'none'))" 'fill="none"' 6
run M3c "lines[4]=lines[4].replace('fill=\"#1C41E3\"','fill=\"red\"'); for (const i of [5,6,7]) lines[i]=lines[i].replace('fill=\"#FFFFFF\"','fill=\"lime\"')" 'fill="lime"' 7
run M3d "lines[4]=lines[4].replace('fill=\"#1C41E3\"','fill=\"#1C41E3FF\"')" 'fill="#1C41E3FF"' 5
run M3e "for (const i of [4,5,6,7]) lines[i]=lines[i].replace(/ fill=\"[^\"]*\"/,'')" '<path d=' 5
run M3f "lines[4]=lines[4].replace('<path fill=\"#1C41E3\"','<path style=\"fill:red\" fill=\"#1C41E3\"')" 'style="fill:red"' 5
fi

if [ "$which" = all ] || [ "$which" = probe ]; then
# --- M6 probes past the list (mine) ---
# P1 honest: a fifth shape with no paint attribute at all -> renders initial fill (black)
run P1-paintless-shape "lines.splice(8,0,'  <circle cx=\"16\" cy=\"20\" r=\"2\"/>')" '<circle cx="16" cy="20" r="2"/>' 9
# P2 honest: a shape inheriting from a <g> that carries the colour in single quotes (does the alternation read inherited paint?)
run P2-group-inherit-sq "lines[5]=\"  <g fill='red'>\"+lines[5].trim()+'</g>'" "<g fill='red'>" 6
# P3 honest: spaces around '=' with single quotes
run P3-spaced-eq-sq "lines[5]=lines[5].replace('fill=\"#FFFFFF\"',\"fill = 'red'\")" "fill = 'red'" 6
# P4 honest: currentColor + color= on the root
run P4-currentColor "lines[0]=lines[0].replace('<svg ','<svg color=\"red\" '); lines[5]=lines[5].replace('fill=\"#FFFFFF\"','fill=\"currentColor\"')" 'fill="currentColor"' 6
# P5 honest: empty single-quoted value
run P5-empty-sq "lines[5]=lines[5].replace('fill=\"#FFFFFF\"',\"fill=''\")" "fill=''" 6
# P6 honest: uppercase SMIL element name (XML is case-sensitive; would not animate, but is the ban case-insensitive as written?)
run P6-SET-upper "lines[4]=lines[4].replace('v-4z\"/>','v-4z\"><SET attributeName=\"fill\" to=\"red\"/></path>')" '<SET ' 5
# P7 honest: SMIL element with a newline right after its name
run P7-set-newline "lines[4]=lines[4].replace('v-4z\"/>','v-4z\"><set\n    attributeName=\"fill\" to=\"red\"/></path>')" '<set$' 5
# P8 honest: gradient with a non-palette stop, single-quoted
run P8-gradient-stop-sq "lines.splice(4,0,'  <linearGradient id=\"g\"><stop offset=\"0\" stop-color=\"#1C41E3\"/><stop offset=\"1\" stop-color=${SQ}#FF00AA${SQ}/></linearGradient>'); lines[5]=lines[5].replace('fill=\"#1C41E3\"','fill=\"url(#g)\"')" "stop-color='#FF00AA'" 5
# P9 adversarial (expected survivor, records §1 out-of-scope): feColorMatrix filter recolours without any paint attribute
run P9-feColorMatrix "lines.splice(4,0,'  <filter id=\"f\"><feColorMatrix type=\"hueRotate\" values=\"180\"/></filter>'); lines[5]=lines[5].replace('<path ','<path filter=\"url(#f)\" ')" '<feColorMatrix ' 5
# P10 adversarial: SMIL element inside an XML comment (must be GREEN — comments do not render)
run P10-set-in-comment "lines[3]=lines[3].replace('-->','<set attributeName=\"fill\" to=\"red\"/> -->')" '<set attributeName' 4
# P11 adversarial: namespace-prefixed SMIL element
run P11-svg-prefixed-set "lines[0]=lines[0].replace('<svg ','<svg xmlns:svg=\"http://www.w3.org/2000/svg\" '); lines[4]=lines[4].replace('v-4z\"/>','v-4z\"><svg:set attributeName=\"fill\" to=\"red\"/></path>')" '<svg:set ' 5
fi
