# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

"""jp_cv_standard v2 — Kasane Teto, Defoko, standard JP CV UTAU"""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from registry import VoicebankModule

VOWEL_MAP = {'AA':'a','AE':'a','AH':'a','AO':'o','AW':'a','AY':'a','EH':'e','ER':'a','EY':'e','IH':'i','IY':'i','OW':'o','OY':'o','UH':'u','UW':'u'}
DIPHTHONG_TAIL = {'AW':'u','AY':'i','EY':'i','OW':'u','OY':'i'}
CONSONANT_MAP = {'B':('b','b'),'CH':('ch','ch'),'D':('d','d'),'DH':('z','z'),'F':('f','h'),'G':('g','g'),'HH':('h','h'),'JH':('j','j'),'K':('k','k'),'L':('r','r'),'M':('m','m'),'N':('n','n'),'NG':('n','n'),'P':('p','p'),'R':('r','r'),'S':('s','s'),'SH':('sh','sh'),'T':('t','t'),'TH':('s','s'),'V':('v','b'),'W':('w','w'),'Y':('y','y'),'Z':('z','z'),'ZH':('z','z')}
CV_RESOLVE = {'a':'a','ba':'ba','cha':'cha','chi':'chi','chu':'chu','cho':'cho','da':'da','de':'de','do':'do','fa':'fa','fi':'fi','fu':'fu','fe':'fe','fo':'fo','ga':'ga','gi':'gi','gu':'gu','ge':'ge','go':'go','ha':'ha','hi':'hi','he':'he','ho':'ho','i':'i','ja':'ja','ji':'ji','ju':'ju','jo':'jo','ka':'ka','ki':'ki','ku':'ku','ke':'ke','ko':'ko','ma':'ma','mi':'mi','mu':'mu','me':'me','mo':'mo','na':'na','ni':'ni','nu':'nu','ne':'ne','no':'no','o':'o','pa':'pa','pi':'pi','pu':'pu','pe':'pe','po':'po','ra':'ra','ri':'ri','ru':'ru','re':'re','ro':'ro','sa':'sa','sha':'sha','shi':'shi','shu':'shu','she':'she','sho':'sho','si':'shi','su':'su','se':'se','so':'so','ta':'ta','ti':'chi','tsu':'tsu','tu':'tsu','te':'te','to':'to','u':'u','e':'e','va':'ba','vi':'bi','vu':'bu','ve':'be','vo':'bo','wa':'wa','wo':'wo','ya':'ya','yu':'yu','yo':'yo','za':'za','zi':'ji','zu':'zu','ze':'ze','zo':'zo','hu':'fu','wu':'u','we':'e','wi':'i'}
ARPABET_VOWELS = {'AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'}

class JPCVStandardModule(VoicebankModule):
    id='jp_cv_standard'; name='Japanese CV — Standard UTAU'
    description='Maps English to JP CV syllables. Compatible with Kasane Teto, Defoko, Utane Uta.'
    author='Melon Synth'; version='2.0.0'; language='en'
    languages=['en','ja','zh','ko','fr','de','es']; phoneme_set='jp_cv'
    target_banks=['Kasane Teto','Defoko','Utane Uta','standard JP CV']
    singability_default=0.65
    singability_notes='0.65 works well for most J-pop and English covers'
    supported_phonemes=set(CV_RESOLVE.values())|{'n','N','-','R'}

    def map_phonemes(self, phonemes, singability):
        from core.mlc_types import SynthToken, PhonemeClass, Confidence
        tokens=[]; i=0; n=len(phonemes)
        while i<n:
            ph=phonemes[i]
            if ph.symbol in ARPABET_VOWELS:
                v=VOWEL_MAP.get(ph.symbol,'a')
                tail=DIPHTHONG_TAIL.get(ph.symbol)
                tokens.append(SynthToken(phoneme=v,display=v,duration_hint=ph.duration_hint,beat_weight=ph.beat_weight,is_vowel=True,stressed=(ph.stress.value==1),phon_class=PhonemeClass.VOWEL,word_index=ph.word_index,syllable_index=ph.syllable_index,source_phoneme=ph.symbol,source_word=ph.source_word,mlc_confidence=ph.confidence,g2p_source=ph.g2p_source,source_confidence=ph.source_confidence))
                if tail and singability<0.6:
                    tokens.append(SynthToken(phoneme=tail,display=tail,duration_hint=0.38,beat_weight=0.15,is_vowel=True,stressed=False,phon_class=PhonemeClass.VOWEL,word_index=ph.word_index,syllable_index=ph.syllable_index,source_phoneme=ph.symbol,source_word=ph.source_word,note='diphthong tail'))
                i+=1
            else:
                acc_c,sing_c=CONSONANT_MAP.get(ph.symbol,('?','?'))
                c=acc_c if singability<0.5 else sing_c
                next_is_vowel=(i+1<n)and(phonemes[i+1].symbol in ARPABET_VOWELS)
                if next_is_vowel:
                    vph=phonemes[i+1]; v2=VOWEL_MAP.get(vph.symbol,'a'); cv=CV_RESOLVE.get(c+v2,c+v2)
                    tokens.append(SynthToken(phoneme=cv,display=cv,duration_hint=vph.duration_hint,beat_weight=vph.beat_weight,is_vowel=False,stressed=(vph.stress.value==1),phon_class=PhonemeClass.STOP,word_index=ph.word_index,syllable_index=ph.syllable_index,source_phoneme=f'{ph.symbol}+{vph.symbol}',source_word=ph.source_word,mlc_confidence=ph.confidence,g2p_source=ph.g2p_source,source_confidence=ph.source_confidence))
                    tail2=DIPHTHONG_TAIL.get(vph.symbol)
                    if tail2 and singability<0.6:
                        tokens.append(SynthToken(phoneme=tail2,display=tail2,duration_hint=0.35,beat_weight=0.12,is_vowel=True,stressed=False,phon_class=PhonemeClass.VOWEL,word_index=ph.word_index,syllable_index=ph.syllable_index,source_phoneme=vph.symbol,source_word=ph.source_word,note='diphthong tail'))
                    i+=2
                else:
                    if ph.is_word_end:
                        if singability>=0.75: i+=1; continue
                        elif singability>=0.45:
                            schwa='u' if c not in('m','n') else 'n'
                            syl=CV_RESOLVE.get(c+schwa,c+schwa)
                            tokens.append(SynthToken(phoneme=syl,display=syl,duration_hint=0.28,beat_weight=0.10,is_vowel=False,stressed=False,phon_class=PhonemeClass.STOP,word_index=ph.word_index,syllable_index=ph.syllable_index,source_phoneme=ph.symbol,source_word=ph.source_word,note='final closure'))
                        else:
                            syl=CV_RESOLVE.get(c+'u',c+'u')
                            tokens.append(SynthToken(phoneme=syl,display=syl,duration_hint=0.45,beat_weight=0.15,is_vowel=False,stressed=False,phon_class=PhonemeClass.STOP,word_index=ph.word_index,syllable_index=ph.syllable_index,source_phoneme=ph.symbol,source_word=ph.source_word,note='final consonant'))
                    else:
                        if singability>=0.55: i+=1; continue
                        else:
                            syl=CV_RESOLVE.get(c+'u',c+'u')
                            tokens.append(SynthToken(phoneme=syl,display=syl,duration_hint=0.30,beat_weight=0.10,is_vowel=False,stressed=False,phon_class=PhonemeClass.STOP,word_index=ph.word_index,syllable_index=ph.syllable_index,source_phoneme=ph.symbol,source_word=ph.source_word,note='cluster'))
                    i+=1
        return tokens

    def postprocess(self, tokens, singability):
        result=[]
        for i,t in enumerate(tokens):
            if t.phoneme=='n' and i+1<len(tokens):
                nxt=tokens[i+1].phoneme
                if nxt and nxt[0] not in 'aeiouAEIOU': t.phoneme='N'; t.display='N'; t.note='coda nasal'
            if t.phoneme in('?','',None): t.phoneme='a'; t.display='a'
            result.append(t)
        return result
